/**
 * Android（bionic）替身：上游 flock 只有 glibc/musl/darwin 预编译。
 * APK 里只有一个 DSH 进程，沿用上游浏览器 worker 的做法——单进程下排他锁直接视为获得。
 * 仍保留 flock(2) 对无效描述符的报错（EBADF），调用方的错误处理路径不变。
 */
import { fstat } from 'node:fs';

export async function tryLockExclusive(fd) {
  await new Promise((resolve, reject) => {
    fstat(fd, (error) => {
      if (!error) return resolve();
      reject(Object.assign(new Error(`${error.code}: flock failed`), { code: error.code, errno: -error.errno, syscall: 'flock' }));
    });
  });
}
