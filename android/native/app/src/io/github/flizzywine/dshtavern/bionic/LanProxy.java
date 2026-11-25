package io.github.flizzywine.dshtavern.bionic;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * 局域网 IPv4 发现与轻量 TCP 转发器。
 * DSH 始终只监听 127.0.0.1，开启局域网访问时由本类在选定的局域网具体 IP 上监听同端口并透明转发到 127.0.0.1，
 * 既满足 DSH 禁止 0.0.0.0 通配绑定的安全要求，又不打断手机本机 WebView 的安全上下文与数据存储。
 */
final class LanProxy {
    private static final int MAX_CONNECTIONS = 128;
    private static final int CONNECT_TIMEOUT_MS = 5_000;
    private static final int BUFFER_SIZE = 32 * 1024;
    private static final Pattern CELLULAR_NAME = Pattern.compile("^(rmnet|ccmni|pdp|wwan|seth_lte|v4-rmnet|clat).*");

    static final class StartResult {
        final List<String> boundIps;
        final String error;

        StartResult(List<String> boundIps, String error) {
            this.boundIps = boundIps;
            this.error = error;
        }
    }

    private final List<ServerSocket> servers = new ArrayList<>();
    private final Set<Socket> activeSockets = new HashSet<>();
    private final AtomicInteger activeConnections = new AtomicInteger();
    private ExecutorService pool;
    private boolean running;

    /** 仅允许 RFC1918 私有局域网 IPv4 与 100.64.0.0/10（CGNAT / Tailscale），拒绝公网与保留地址。 */
    static boolean isAllowedLanIpv4(byte[] addr) {
        if (addr == null || addr.length != 4) return false;
        int b0 = addr[0] & 0xFF;
        int b1 = addr[1] & 0xFF;
        if (b0 == 10) return true; // 10.0.0.0/8
        if (b0 == 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12
        if (b0 == 192 && b1 == 168) return true; // 192.168.0.0/16
        return b0 == 100 && (b1 & 0xC0) == 64; // 100.64.0.0/10
    }

    /** 发现本机可用于局域网/热点/USB 共享/VPN 访问的私有 IPv4 地址，按优先级排序并排除蜂窝数据网卡。 */
    static List<String> discoverLanAddresses(Context context) {
        Set<String> wifiOrEthIfaces = new HashSet<>();
        Set<String> vpnIfaces = new HashSet<>();
        Set<String> cellularIfaces = new HashSet<>();
        try {
            ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
            if (cm != null) {
                for (Network net : cm.getAllNetworks()) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                    LinkProperties lp = cm.getLinkProperties(net);
                    String iface = lp != null ? lp.getInterfaceName() : null;
                    if (caps == null || iface == null || iface.isEmpty()) continue;
                    String lower = iface.toLowerCase(Locale.ROOT);
                    boolean hasWifiOrEth = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                            || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
                    boolean hasCellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
                    boolean hasVpn = caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
                    if (hasWifiOrEth && !hasCellular) wifiOrEthIfaces.add(lower);
                    if (hasVpn) vpnIfaces.add(lower);
                    if (hasCellular && !hasWifiOrEth) cellularIfaces.add(lower);
                }
            }
        } catch (Exception ignored) {
        }

        List<LinkedHashSet<String>> buckets = new ArrayList<>(4);
        for (int i = 0; i < 4; i++) buckets.add(new LinkedHashSet<>());

        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface nif = ifaces.nextElement();
                if (nif == null) continue;
                try {
                    if (!nif.isUp() || nif.isLoopback()) continue;
                } catch (Exception ignored) {
                    continue;
                }
                String rawName = nif.getName();
                String name = rawName == null ? "" : rawName.toLowerCase(Locale.ROOT);
                if (cellularIfaces.contains(name) || CELLULAR_NAME.matcher(name).matches()) continue;

                int bucket = classifyBucket(name, wifiOrEthIfaces, vpnIfaces);
                Enumeration<InetAddress> addrs = nif.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (!(addr instanceof Inet4Address)) continue;
                    if (addr.isLoopbackAddress() || addr.isLinkLocalAddress()
                            || addr.isAnyLocalAddress() || addr.isMulticastAddress()) continue;
                    if (!isAllowedLanIpv4(addr.getAddress())) continue;
                    String host = addr.getHostAddress();
                    if (host != null && !host.isEmpty()) buckets.get(bucket).add(host);
                }
            }
        } catch (Exception ignored) {
        }

        LinkedHashSet<String> merged = new LinkedHashSet<>();
        for (LinkedHashSet<String> b : buckets) merged.addAll(b);
        return Collections.unmodifiableList(new ArrayList<>(merged));
    }

    private static int classifyBucket(String name, Set<String> wifiOrEthIfaces, Set<String> vpnIfaces) {
        if (wifiOrEthIfaces.contains(name) || name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("en")) {
            return 0;
        }
        if (name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("rndis")
                || name.startsWith("usb") || name.startsWith("bt-pan")) {
            return 1;
        }
        if (vpnIfaces.contains(name) || name.startsWith("tun") || name.startsWith("wg") || name.startsWith("tailscale")) {
            return 2;
        }
        return 3;
    }

    /** 在指定局域网 IP 列表的同端口上启动 TCP 透明转发至 127.0.0.1:port。 */
    synchronized StartResult start(List<String> ips, int port) {
        stop();
        if (ips == null || ips.isEmpty()) {
            return new StartResult(Collections.emptyList(), "没有可用的局域网地址");
        }
        AtomicInteger threadSeq = new AtomicInteger();
        ExecutorService exec = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "lan-proxy-" + threadSeq.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
        pool = exec;
        running = true;

        List<String> bound = new ArrayList<>();
        StringBuilder errs = new StringBuilder();
        for (String ip : ips) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(InetAddress.getByName(ip), port), 64);
                servers.add(ss);
                bound.add(ip);
                Thread acceptThread = new Thread(() -> acceptLoop(ss, port, exec), "lan-accept-" + ip);
                acceptThread.setDaemon(true);
                acceptThread.start();
            } catch (Exception e) {
                if (errs.length() > 0) errs.append("；");
                errs.append(ip).append("：").append(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }
        String err = bound.isEmpty() && errs.length() > 0 ? errs.toString() : null;
        return new StartResult(Collections.unmodifiableList(bound), err);
    }

    private void acceptLoop(ServerSocket ss, int port, ExecutorService exec) {
        while (true) {
            Socket client;
            try {
                client = ss.accept();
            } catch (IOException e) {
                return;
            }
            if (!isRunning()) {
                closeQuietly(client);
                return;
            }
            try {
                exec.execute(() -> handleClient(client, port));
            } catch (Exception e) {
                closeQuietly(client);
                return;
            }
        }
    }

    private synchronized boolean isRunning() {
        return running;
    }

    private synchronized boolean registerPair(Socket client, Socket upstream) {
        if (!running) return false;
        activeSockets.add(client);
        activeSockets.add(upstream);
        return true;
    }

    private synchronized void unregisterPair(Socket client, Socket upstream) {
        activeSockets.remove(client);
        activeSockets.remove(upstream);
    }

    private void handleClient(Socket client, int upstreamPort) {
        if (activeConnections.incrementAndGet() > MAX_CONNECTIONS) {
            activeConnections.decrementAndGet();
            closeQuietly(client);
            return;
        }
        Socket upstream = new Socket();
        try {
            client.setTcpNoDelay(true);
            upstream.connect(new InetSocketAddress(InetAddress.getByAddress(new byte[]{127, 0, 0, 1}), upstreamPort), CONNECT_TIMEOUT_MS);
            upstream.setTcpNoDelay(true);
            if (!registerPair(client, upstream)) {
                closeQuietly(client);
                closeQuietly(upstream);
                return;
            }
            ExecutorService exec = this.pool;
            if (exec == null) return;
            Future<?> upToDown = exec.submit(() -> relay(client, upstream));
            relay(upstream, client);
            try {
                upToDown.get();
            } catch (Exception ignored) {
            }
        } catch (Exception e) {
            closeQuietly(client);
            closeQuietly(upstream);
        } finally {
            unregisterPair(client, upstream);
            closeQuietly(client);
            closeQuietly(upstream);
            activeConnections.decrementAndGet();
        }
    }

    /** 单向转发字节流；正常 EOF 时半关闭写端，发生 IO 异常时立刻关掉两端 Socket 避免另一方向挂死。 */
    private static void relay(Socket from, Socket to) {
        byte[] buf = new byte[BUFFER_SIZE];
        try {
            InputStream in = from.getInputStream();
            OutputStream out = to.getOutputStream();
            int n;
            while ((n = in.read(buf)) != -1) {
                if (n > 0) {
                    out.write(buf, 0, n);
                    out.flush();
                }
            }
            try {
                to.shutdownOutput();
            } catch (IOException ignored) {
            }
        } catch (IOException e) {
            closeQuietly(from);
            closeQuietly(to);
        }
    }

    /** 停止所有监听端口并立即断开全部活跃的局域网代理连接。 */
    synchronized void stop() {
        running = false;
        for (ServerSocket ss : servers) closeQuietly(ss);
        servers.clear();
        for (Socket s : activeSockets) closeQuietly(s);
        activeSockets.clear();
        if (pool != null) {
            pool.shutdownNow();
            pool = null;
        }
    }

    private static void closeQuietly(ServerSocket ss) {
        if (ss != null) try { ss.close(); } catch (IOException ignored) {}
    }

    private static void closeQuietly(Socket s) {
        if (s != null) try { s.close(); } catch (IOException ignored) {}
    }
}
