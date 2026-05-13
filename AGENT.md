# AGENT.md

## 开发约定

- 开始复杂功能前，先阅读项目结构和相关文件，不要凭空猜测。
- 非简单修改，先使用 spec-driven-development 明确需求边界。
- 大功能开发前，使用 planning-and-task-breakdown 拆分任务。
- 修改代码时，遵循 incremental-implementation，小步修改、小步验证。
- 涉及功能逻辑时，优先使用 test-driven-development。
- 涉及前端页面时，使用 frontend-ui-engineering。
- 涉及接口、数据库、权限、登录、上传时，必须考虑 security-and-hardening。
- 修改完成后，使用 code-review-and-quality 自查。
- 不要一次性大规模重构，除非我明确要求。
- 修改前先阅读相关页面、组件、接口、Prisma 模型和既有样式，优先沿用当前项目结构与命名方式。
-

## UI 修改重要提示

重要提示：修改任何 UI 之前，请先观察并保持与当前主体风格一致，包括布局密度、色彩体系、组件形态、交互节奏、字号层级和中文业务表达；不要引入与主体不一致的视觉风格或孤立的新设计语言。
## 完成后必须告诉我

1. 修改了哪些文件
2. 实现了什么功能
3. 如何测试
4. 是否有风险
5. 下一步建议