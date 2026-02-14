# 项目情况

本项目是 SRVPro（YGOPro 服务器）项目的下一代项目。

## 项目规范

- 非必要不要在 Room 和 Client 里面加字段或者方法。如果可以的话请使用定义 interface 进行依赖合并。
- 进行协议设计需要核对 ygopro 和 srvpro 的 coffee 和 cpp 的实现。
- 尽量定义新的模块实现功能，而不是在之前的方法上进行修改。

## 部分实现细节

### 和 srvpro 的对应关系

- srvpro 里面的 client.send（发送给客户端）还是对应 client.send
- srvpro 里面 server.send（模拟客户端发送消息）对应 this.ctx.dispatch(msgClassInstance, client)

## 参考项目

可以参考电脑的下面的项目，用来参考

- ygopro-msg-encode（js 协议库）: ~/ygo/ygopro-msg-encode
- koishipro-core.js（wasm 层）: ~/ygo/koishipro-core.js
- ocgcore（YGOPro ocgcore 内核）: ~/ygo/ygopro/ocgcore
- ygopro（YGOPro 主程序服务端）: ~/ygo/ygopro/gframe
- srvpro（本项目的上一代）: ~/ygo/ygopro/srvpro-koishi
- yuzuthread（多线程执行器）: ~/test/yuzuthread
- typed-reflector（反射器）: ~/test/koishi-related/typed-reflector
- nfkit（工具库,事件触发器，IoC）: ~/test/nfkit
