# 性能基线

自动化可重复测量项包括 WXT/Vite 构建耗时、扩展总包体、SQLite migration/FTS 测试和 Native Host Mock 流延迟。浏览器/桌面空闲内存、真实首段耗时、DOM 写入、PDF 渲染及取消响应需要 GUI/真实供应商环境，当前不伪造数值。

本次生产构建观测：Edge/Chrome 单次 WXT 构建约 1.2 秒；单浏览器未压缩总产物约 2.67 MB，其中本地 PDF worker 约 1.98 MB；桌面 Vite 构建约 0.6 秒。硬件与冷缓存条件未标准化，这些值只作本机开发记录。
