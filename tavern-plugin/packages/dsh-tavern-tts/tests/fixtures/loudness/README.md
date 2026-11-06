# 语音响度参考

这 8 段无个人信息的英语语音由 Windows System.Speech 离线合成（不播放、不调用付费服务），两个句子分别以 16000、24000、32000、44100 Hz、PCM16 单声道输出。near-clipping 为 32 kHz 第一段乘 3 并限幅；quiet 为同一段乘 0.003。reference.json 是本机 PATH 中 ffmpeg loudnorm 的参考表，不使用 golden digest。

句子：
- The morning train arrived beside the river. Please close the door, and wait here until the rain has stopped.
- A quiet voice can still tell a wonderful story. Today we will walk through the garden and listen to the birds.

更新参考：运行插件 tests/tools/loudness-reference.mjs（仅开发工具需要 ffmpeg）；常规 js-loudness.test.mjs 读取已保存参考，不依赖 ffmpeg。
比较命令使用 apad=whole_dur=0.4,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json 的 input_i/input_tp。

本次结果：最大绝对偏差 I=0.370 LU、TP=0.007 dB，均低于 0.5；10 秒 32 kHz 单声道测量 15.97 ms（要求 <30 ms）。这不是所有频率与所有信号的认证；立体声通过双通道能量及真峰值回归覆盖。
