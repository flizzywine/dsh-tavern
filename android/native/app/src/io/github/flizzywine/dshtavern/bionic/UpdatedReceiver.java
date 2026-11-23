package io.github.flizzywine.dshtavern.bionic;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 覆盖安装新版后系统会杀掉旧进程：收到 MY_PACKAGE_REPLACED 时重新拉起服务（顺带完成程序文件替换），再打开界面。 */
public final class UpdatedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        try {
            context.startForegroundService(TavernService.intent(context, TavernService.ACTION_START));
        } catch (Exception ignored) {
            // 部分系统不允许此时启动前台服务：用户下次打开应用时会照常启动。
        }
    }
}
