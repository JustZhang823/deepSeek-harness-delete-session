# Delete Session · 删除会话

这是 DeepSeek Harness 删除会话插件的包目录，也是 Plugin Manager `install_bundle` 的安装目标。

**完整的安装说明、界面图与使用方法见 [仓库首页](https://github.com/JustZhang823/deepSeek-harness-delete-session)。**

| 功能 | 行为 |
|---|---|
| 永久删除 | 删除所选会话日志、消息、派生投影缓存及工作区/归档/置顶记录 |
| 默认确认 | 预览影响范围并勾选确认后执行 |
| 可选直接删除 | 一次已确认的删除成功后保存偏好；可在菜单恢复确认 |
| 运行保护 | 活动或维护中的会话拒绝删除；空闲已加载会话先安全释放 |

项目文件、共享附件及子会话日志保留；**删除无法通过 Harness 恢复**。

- [安装与使用](https://github.com/JustZhang823/deepSeek-harness-delete-session#安装与启用)
- [前置条件、错误码与实现细节](https://github.com/JustZhang823/deepSeek-harness-delete-session/blob/main/docs/technical-details.md)
- [English package documentation](README.en.md)
- [MIT License](LICENSE)

无需构建或第三方运行时依赖。测试命令：

```bash
node --test test/*.test.mjs
```
