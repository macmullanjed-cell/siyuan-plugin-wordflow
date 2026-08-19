# SiWords 生词高亮 0.6.7

[English](README.md)

[快速开始](#快速开始) · [问题反馈](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new/choose) · [功能建议](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=feature.yml) · [更新记录](CHANGELOG.md)

**在思源文档和文字层 PDF 中积累生词，让以后再次遇到的词更容易被看见和复习。**

SiWords 是面向思源笔记独立实现的生词高亮与复习插件。核心流程是“划词加入词库 → 再次出现时高亮 → 悬停查看释义和来源 → 标记掌握”，同时提供多生词本、发音、可靠本地存储和可选 AI 释义/翻译。

当前主要支持 **Windows 桌面端**；PDF 需要具有可选择的文字层。

SiWords 不隶属于 HiWords、Obsidian 或思源笔记官方。

## 快速开始

1. 从思源集市安装并启用 SiWords。
2. 在思源文档或带文字层的 PDF 中选中单词或短语，按 `Ctrl+Alt+Shift+A` 打开“添加单词”窗口，也可使用划词按钮或右键菜单。
3. 词条再次出现在启用范围内时会按设置高亮；稳定悬停后可查看释义、原句、来源和掌握操作。
4. 在独立词库页或当前文档侧栏中整理词条。AI 不会因划词或打开文档自动运行，只有主动点击按钮或执行 AI 命令才会联网。

## 主要功能

- 从思源文档或带文字层的 PDF 中添加选中的单词和短语。
- 按文档范围和显示样式高亮学习中的词。
- 在稳定悬停词卡中查看释义、原句、来源、发音和掌握操作。
- 悬浮词窗为基础释义提供独立编辑入口；保存时只修改基础释义，词汇扩展和其他 Markdown 分节保持不变。“完整编辑”仍作为高级入口保留。
- 鼠标短暂移出词窗边缘时有不遮挡正文的空间容错；真正离开后仍会自动关闭，外部点击仍立即关闭。
- Windows 桌面词条窗口可以从四条边或四个角拖动缩放；手动调整后保持打开、允许选择或复制窗口内文字，并在本次思源会话中复用尺寸。
- 使用多个生词本、颜色、别名、归档状态和掌握状态组织词条。
- 通过独立词库页和当前文档侧栏管理词条。
- 导入、导出完整 JSON 词库。
- 通过待写入恢复、滚动备份、回收站和结构校验防止数据损坏。
- 可选使用插件独立 API 或思源当前 AI 生成上下文释义、划词翻译，以及同根词、近义词和形近 / 易混词扩展。
- AI 词汇扩展由插件本地去重、限制每类最多 3 个，并按“词条标题 + 释义 + 构词/辨析/区别”卡片写入固定 Markdown 分节；重复执行只更新该分节，不覆盖其他手工释义。
- 释义与词汇扩展同时存在时显示为独立标签；只有扩展时提供不写入词库的基础释义空状态。重新生成 AI 释义会保留请求期间的手工分节和词汇扩展。
- 使用思源 AI 配置时，插件优先读取“编辑”场景模型，并读取真实 API 名称而不是思源内部 ID；仅对 DeepSeek 官方地址自动兼容已退役的 `deepseek-chat` / `deepseek-reasoner` 别名。当前自动读取支持 OpenAI 协议，其他协议会明确提示改为单独配置。仍建议在思源 AI 设置中把模型名正式更新为当前名称。

## 快捷键

- `Ctrl+Alt+Shift+A`：将当前选区和所在句子带入“添加单词”窗口，不会自动保存。
- `Ctrl+Alt+Shift+E`：为当前添加/编辑窗口中的单词生成词汇扩展，不会自动保存。

0.6.4 使用了新的命令身份和三修饰键，避免旧版 `Ctrl+Alt+A/E` 与思源内置命令或其他插件的持久化冲突。仍可在思源“设置 → 快捷键”中搜索 `SiWords` 后重新绑定。

## 兼容范围

- 思源笔记 3.7.0 及以上
- Windows 桌面端
- 0.6.7 界面为简体中文，同时提供英文集市元数据和说明文档
- PDF 必须具有可选择的文字层；扫描 PDF 需要先 OCR

首个公开版本不声明支持 macOS、Linux、移动端、浏览器前端、Canvas 或多设备同时修改的逐词自动合并。

## 安装

### 思源集市

插件通过审核后，打开“集市 → 插件”，搜索“SiWords”，安装并启用。

### 手动安装

1. 从最新 GitHub Release 下载 `package.zip`。
2. 解压到 `{思源工作空间}/data/plugins/siyuan-plugin-wordflow/`。
3. 重启思源，在“已下载”插件中启用 SiWords。

## AI 与联网行为

AI 不会自动发起请求。只有用户主动点击 AI 释义、AI 词汇扩展、划词翻译、连接测试，或执行对应 AI 快捷命令时，插件才会向所选服务发送请求。发送内容可能包括选中的单词或文本、原句、提示词、模型标识和请求参数。AI 生成的词源和语义关系可能有误，保存前必须人工检查。

自定义 TTS 会把需要发音的单词发送到用户配置的音频地址；系统语音不会使用自定义 TTS 地址。

公网地址必须使用 HTTPS。仅 `localhost`、`127.0.0.1` 和 `::1` 可以使用 HTTP，以兼容本机模型服务。启用联网功能前请阅读 [PRIVACY.md](PRIVACY.md)。

## 数据和备份

词库通过思源插件数据接口保存。API Key 与词库分开存储，不进入词库导出和滚动备份；但它仍是本地插件数据，并没有进入操作系统密钥库。

大量导入或调整同步方案前，请先导出一份完整 JSON 备份。

## 帮助与反馈

- [报告功能异常](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=bug.yml)
- [报告卡顿或性能问题](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=performance.yml)
- [报告思源版本、主题或环境兼容问题](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=compatibility.yml)
- [提出功能建议](https://github.com/macmullanjed-cell/siyuan-plugin-wordflow/issues/new?template=feature.yml)

提交问题时，请尽量提供 SiWords 版本、思源版本、Windows 版本、问题发生在文档还是 PDF、复现步骤，以及去除私人内容后的截图。GitHub Issue 是公开页面；请勿粘贴 API Key、密码、访问令牌、私人文档正文、完整词库或其他敏感信息。

这些反馈链接不会自动读取或上传思源文档、PDF、词库、原句、API 配置或已启用插件列表。所有将要公开的文字和附件都由用户在 GitHub 提交前自行查看和决定。

## 与 HiWords 的关系

阅读流程参考了采用 0BSD 许可证发布的开源项目 [HiWords](https://github.com/CatMuse/HiWords)。SiWords 是针对思源的独立实现，不复制 Obsidian 接口、Canvas 存储、品牌、图标或集市身份。

## 许可证

SiWords 使用 [0BSD License](LICENSE) 发布。
