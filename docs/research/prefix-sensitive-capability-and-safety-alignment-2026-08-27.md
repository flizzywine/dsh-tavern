# 前缀为何会改变 LLM 的能力与安全行为

> 状态：文献研究，记录于 2026-08-27。本文只讨论机制、证据边界和安全的对照实验设计，不提供用于绕过真实安全防护的提示词。

## 结论先行

用户的核心猜想有理论和实验依据，但需要拆成两个不同命题：

1. **输出端前缀敏感**：强证据。若模型已经被迫从某几个 `assistant` token 开始续写，后续行为可能迅速进入不同轨迹。当前安全对齐往往过度集中在最初几个输出 token，这被称为 **shallow safety alignment（浅层安全对齐）**。
2. **输入端长前缀敏感**：有证据，但机制不唯一。《斗破苍穹》一类小说前缀可能同时提供任务/文体识别、上下文示范、角色扮演框架和位置偏置；现有研究不能证明“小说文本本身”是一个特殊安全开关。

因此，当前最稳妥的理论模型不是“安全文本抵消安全文本”，而是：

```text
输入上下文决定模型识别到的任务分布和对话模式
                ↓
最初几个输出 token 选择一条生成轨迹
                ↓
自回归条件化使后续 token 倾向维持局部连贯
                ↓
若安全训练主要只守住拒绝开头，轨迹一旦偏离就不容易恢复
```

对 dsh-tavern 最重要的产品判断是：**不要先把长篇小说当成“神奇前缀”固化进运行时；先分别验证输入前缀、消息角色/位置和输出 prefill，找出真正起作用的变量。**

## 一、证据分级

### A. 直接证据：安全行为确实对最初输出 token 敏感

#### 1. 浅层安全对齐

[Safety Alignment Should Be Made More Than Just a Few Tokens Deep（Qi et al., ICLR 2025）](https://proceedings.iclr.cc/paper_files/paper/2025/file/88be023075a5a3ff3dc3b5d26623fa22-Paper-Conference.pdf) 是目前与本问题最直接的论文。

论文的核心主张是：很多对齐模型主要改变了有害请求下**最前面几个输出 token** 的分布，使模型高概率以固定拒绝句式开头；后续 token 的分布与未对齐底模差异小得多。

关键实验：

- 在 HEx-PHI 上，Llama-2-7B-Chat 有 96.1% 的安全回答以两类固定拒绝短语开头；Gemma-7B-1.1-IT 有 96.7% 以同一类固定拒绝短语开头。
- 给未对齐的 Llama-2-7B base 预填一个拒绝前缀后，有害率可由 `68.6%` 降到最低 `2.1%`；Gemma-7B base 可由 `85.4%` 降到最低 `1.0%`。这说明预训练本身已经学会“拒绝开头之后通常继续拒绝”。
- 反向实验中，只要预填越来越多的非拒绝输出 token，对齐模型的攻击成功率会从接近 0 快速升到 50% 以上。
- 论文用安全恢复样本训练模型，让它即使已经从不安全轨迹开头也能转回拒绝。Llama-2-7B-Chat 在预填 5/10/20/40 个 token 时，攻击成功率从 `42.1/51.5/56.1/57.0%` 降至 `2.8/2.9/3.4/4.5%`。

这直接支持“安全后训练也对开头敏感”，但证据对象是**模型输出开头**，不是放在输入最前面的小说正文。

#### 2. assistant prefill 是真实的模型控制面

[DeepSeek Chat Prefix Completion 官方文档](https://api-docs.deepseek.com/guides/chat_prefix_completion/) 明确允许把最后一条消息设为 `assistant`，并设置 `prefix=true`，要求模型从给定内容继续生成。官方示例用代码块开头强制回答进入代码格式。

这证明 assistant prefill 并非仅是提示词技巧，而是供应商正式暴露的解码控制面。它证明“生成从哪里开始”会强约束输出，但官方文档本身不证明任何安全结论。

#### 3. 前缀注入与“竞争目标”

[Jailbroken: How Does LLM Safety Training Fail?（Wei et al., 2023）](https://arxiv.org/abs/2307.02483) 把安全失败概括为两类：

- **competing objectives**：预训练中的续写/连贯性与安全拒绝目标冲突；
- **mismatched generalization**：模型有某个能力，但安全训练没有覆盖该表达域或格式。

论文直接比较了有语义延续力的肯定式开头与无关问候开头；前者更容易改变 GPT-4 的后续行为，说明效果不只是“前面随便多几个 token”，而与前缀在预训练分布中暗示的自然续写有关。

这与浅层安全对齐互补：前者给出“预训练连贯性与安全目标竞争”的行为解释，后者给出“安全 KL 预算主要花在前几个 token”的更细机制证据。

### B. 直接证据：输入上下文中的示范可以改变安全分布

#### 4. 安全示范比一段抽象安全声明更有直接依据

[Jailbreak and Guard Aligned Language Models with Only Few In-Context Demonstrations（Wei et al., 2023）](https://arxiv.org/abs/2310.06387) 同时研究了 In-Context Attack（ICA）和 In-Context Defense（ICD）：同样的模型，只改变前置对话示范，安全行为就会改变。

与“固定注入一段安全内容”直接相关的是 ICD：它不是堆安全原则，而是放入“边界请求 → 安全回答”的成对示范。

- 对黑盒 GCG-T，2 个安全示范把 Vicuna 的攻击成功率从 `60%` 降到 `4%`、Llama-2 从 `21%` 降到 `0%`、GPT-4 从 `1%` 降到 `0%`；QWen 只从 `35%` 降到 `21%`。
- 对 PAIR，2 个示范把 Llama-2 从 `26%` 降到 `2%`、GPT-4 从 `20%` 降到 `2%`，但 Vicuna 仍有 `48%`。
- 对自适应白盒攻击，效果明显减弱，不能视为稳固防线。

所以，如果目标真的是加强安全而不是改变内容边界，现有论文更支持**短小、结构化的安全示范**，不支持泛化为“任意长安全文本都有效”。

#### 5. 长上下文会放大 in-context learning，而非简单“稀释”

[Many-shot Jailbreaking（Anil et al., Anthropic, 2024）](https://www.anthropic.com/research/many-shot-jailbreaking) 用数十到数百个对话示范研究长上下文安全。攻击效果随示范数量按幂律增强；相似幂律也出现在正常的 in-context learning 任务上。作者据此认为该现象更像 ICL 的安全副作用，而非单纯 token 数量造成的注意力稀释。

该研究还显示：仅靠进一步微调拒绝这类输入会推迟失效点，却未消除随上下文增长出现的问题；输入预处理/分类在其测试中更有效。

这给《斗破苍穹》前缀一个更谨慎的解释：若长文本展示了稳定的小说续写分布，模型可能把后续请求当作同一分布中的新样本；但没有成对示范的单篇小说，是否等价于 many-shot ICL，仍需实验确认。

### C. 机制证据：拒绝行为可能是低维而脆弱的

#### 6. 拒绝方向

[Refusal in Language Models Is Mediated by a Single Direction（Arditi et al., NeurIPS 2024）](https://proceedings.neurips.cc/paper_files/paper/2024/hash/f545448535dfde4f9786555403ab7c49-Abstract-Conference.html) 在 13 个开源聊天模型、最高 72B 参数上发现一个可因果干预的“拒绝方向”：

- 从残差流中去掉该方向会显著降低拒绝；
- 把该方向加入无害请求的激活会诱发错误拒绝；
- 对一个 Qwen 模型的机制分析发现，优化后的对抗后缀会抑制该方向的传播，并劫持若干关键注意力头。

这说明拒绝行为至少在这些模型上存在低维、可操纵的内部瓶颈，为“很小的上下文变化可触发很大行为变化”提供机制层支持。

边界也很重要：论文把自己定位为存在性证明；“拒绝方向”的语义未完全解释，实验主要针对开源模型，且**拒绝不等于完整安全**。模型仍可能有输入分类器、输出分类器和供应商服务端规则。

### D. 间接证据：开头会锁定能力轨迹

#### 7. 少量推理前缀可以训练出明显能力变化

[The First Few Tokens Are All You Need: UPFT（Ji et al., 2025）](https://arxiv.org/abs/2503.02875) 发现不同推理轨迹常共享初始步骤，并只用短前缀做无监督微调。Llama-3.1-8B-Instruct 在 MATH500 上以 8-token 前缀取得最佳平均结果；论文报告相对完整轨迹训练减少 75% 训练时间和 99% 采样成本，同时达到接近监督方法的推理表现。

它支持“前几个 token 携带轨迹选择信号”，但这是**微调证据**，不能直接推出推理时任意输入前缀或安全前缀会产生同等效应。

### E. 位置效应：长前缀可能增强，也可能让指令被忘记

#### 8. Lost in the Middle 只证明位置偏置，不证明安全稀释

[Lost in the Middle（Liu et al., TACL 2024）](https://aclanthology.org/2024.tacl-1.9/) 在多文档问答和键值检索中发现 U 形位置效应：关键信息位于输入开头或末尾时通常最好，放在中间时明显变差；多文档问答最坏情况下可下降 20 个百分点以上。

这可以解释为什么“最开头的小说”可能仍有强影响，也提示夹在长文本中间的安全说明可能被弱化。但该论文没有研究安全行为，因此只能作为位置偏置的间接证据。

#### 9. 对长输入，任务指令放在末尾有时更可靠

[Instruction Position Matters in Sequence Generation（Liu et al., Findings of ACL 2024）](https://aclanthology.org/2024.findings-acl.693/) 研究翻译与摘要，发现长输入会出现 instruction forgetting；把任务指令从输入之前移到输入之后，最高提升 9.7 BLEU 和 3.5 ROUGE。

这构成一个重要边界：不能仅凭“模型对前缀敏感”就断定规则必须放最前。对某些任务，**靠近生成位置的末尾指令反而更强**。dsh-tavern 应把“前置协议”和“历史后置短提醒”作为独立变量比较。

#### 10. 安全 prompt/template 的作用具有模型差异

[Keeping LLMs Aligned After Fine-tuning: The Crucial Role of Prompt Templates（Lyu et al., NeurIPS 2024）](https://proceedings.neurips.cc/paper_files/paper/2024/hash/d6f034bb216b472fc7d32ec7aff20342-Abstract-Conference.html) 表明推理时使用安全 system prompt 可以在多种微调设置中降低攻击成功率，但不同模型族差异明显。

Arditi et al. 的系统提示消融也显示这种差异：在其白盒干预实验中，Llama-2-7B 带/不带默认 system prompt 的攻击成功率为 `22.6% / 79.9%`，Qwen-7B 则为 `79.2% / 74.8%`。因此“固定安全文本”不是跨模型稳定常数，文本、chat template、训练分布和模型族必须一起看。

## 二、叙事/角色扮演为何可能有效

### 直接观察

[DeepInception（Li et al., 2023/后续修订）](https://arxiv.org/abs/2311.03191) 用嵌套虚构场景、角色和层级结构测试多种模型，并通过拆分场景、层数和组合做消融。论文报告不同场景在不同模型上的效果不同，并猜测这与预训练语料分布有关。

它支持以下较弱结论：

- 叙事场景可以成为安全训练没有完全覆盖的表达域；
- 嵌套任务会增加模型优先完成“保持场景、继续角色、维持连贯”的压力；
- 特定小说或文体的效果可能来自模型对相应语料分布的熟悉度。

### 不能直接接受的机制说法

DeepInception 使用“催眠”“自我迷失”“服从权威”等心理学类比，但其实验没有证明模型拥有对应心理过程。它的困惑度和组件消融证明提示结构有效，不足以在内部机制层证明“模型被催眠”。

更稳妥的解释仍是两类：

1. **竞争目标**：小说续写、角色一致性和任务完成的概率压力与拒绝目标竞争；
2. **泛化错配**：模型在小说/嵌套叙事中有很强能力，但安全训练对这种分布覆盖不足。

### 反证：角色扮演不是通用开关

《Jailbroken》在 Claude v1.3 上测试的角色扮演攻击成功率为 0%，作者认为该模型可能专门训练过拒绝有害角色扮演；它甚至会对某些无害角色扮演控制样本过度拒绝。

所以“角色扮演有效”取决于模型版本和安全训练覆盖。即使《陨落的天才》在当前模型上有效，也不能推导出小说前缀具有跨模型、跨版本稳定性。

## 三、对“先固定注入安全内容，再开始游戏”的回答

### 理论上可能发生的三种不同效果

| 注入形式 | 最可能机制 | 现有证据强度 |
| --- | --- | --- |
| 一段抽象安全原则 | system prompt / 任务边界提示 | 中等，模型差异大 |
| 1–2 组安全处理示范 | in-context defense，直接展示期望映射 | 较强，但对自适应攻击有限 |
| assistant 输出开头 | 直接选择自回归轨迹 | 很强，但它与输入前缀不是同一变量 |
| 长篇无关小说 | 文体/任务分布定位、位置偏置、上下文示范 | 间接；具体机制尚未识别 |

因此，如果实验目的是解释《陨落的天才》的成功原因，单独加入一段安全声明不是最佳第一步。它同时改变长度、语义、任务框架和安全先验，结果很难归因。

## 四、dsh-tavern 可操作的安全实验

### 1. 先回答四个不同问题

1. **内容身份**：是不是任何中文网文都有效，还是只有特定作品有效？
2. **位置**：同一前缀放在最前、历史中间、最后用户输入之前，结果是否不同？
3. **角色**：同一文本作为 `system`、`user`、历史 `assistant`，效果是否不同？
4. **轨迹**：真正起作用的是输入上下文，还是最终 `assistant prefill`？

这四个问题必须分开，否则不能得到理论结论。

### 2. 建议的最小阶梯

保持模型、供应商、chat template、人物卡、真实游戏输入、采样参数、流式设置、重试策略完全相同，并保存最终 provider HTTP body。

| 阶梯 | 唯一变量 | 目的 |
| --- | --- | --- |
| C0 | 无额外前缀 | 基线 |
| C1 | 短、原创、无安全含义的中文小说开场 | 测叙事模式本身 |
| C2 | 与 C1 等 token 的说明文 | 区分叙事激活与长度效应 |
| C3 | 与原方案等 token 的另一部/原创同风格小说 | 区分具体文本与文体分布 |
| C4 | 把 C1 从最前移到历史末尾 | 测位置效应 |
| C5 | 同一 C1 改变消息 role，正文不变 | 测 chat template/角色效应 |
| C6 | 不加输入前缀，只做无害的输出格式 prefill | 测输出轨迹效应 |

不要一开始把“安全声明 + 小说 + assistant prefill”一起加入；那会把至少三个机制混在同一级。

### 3. 评价指标

使用安全、成年、无亲属关系、无现实危害的角色扮演夹具，只测试模型是否稳定进入目标叙事模式，不优化对真实供应商安全审核的绕过。

每个条件至少重复多次，并同时记录：

- 第一批输出 token 与首句类别：拒绝、元讨论、正常叙事；
- 完成目标叙事的比例，而不只是“没有出现拒绝词”；
- 角色/文体一致性；
- 最终请求的消息 role/order、逐条 token 数和哈希；
- 采样参数、`stream`、`finish_reason`、重试次数和服务端错误；
- 提供商输入/输出审核与模型内拒绝能否区分。

### 4. 最有信息量的判别结果

- **C1/C3 有效，C2 无效**：支持“叙事/文体分布定位”，不支持纯长度稀释。
- **C1/C2/C3 都随长度增强**：更像长上下文 ICL、位置或注意力效应。
- **只有特定原文有效**：需要继续做短语块/段落级消融，不能直接称为小说模式。
- **移到历史末尾更强**：支持 instruction forgetting / recency，而非开头 primacy。
- **只有 assistant prefill 明显改变结果**：主要是输出轨迹锁定，不应把功劳归给输入小说。
- **请求相同但结果仍不稳定**：优先检查采样、重试、供应商审核和模型版本，不再解释为提示词结构。

## 五、当前理论框架

可以暂时用下面五层来指导后续研究：

1. **预训练分布**：模型学会了小说如何继续、拒绝句如何继续、代码块如何继续。
2. **后训练的任务路由**：SFT/RLHF 把某些输入映射到“帮助”或“拒绝”的开头，但这种路由可能很浅。
3. **上下文学习**：输入中的示范、文体和角色让模型临时重估当前任务分布。
4. **自回归轨迹依赖**：一旦最初输出 token 落在某条轨迹，局部连贯性会让后续维持该轨迹；稳固对齐应能中途恢复，而不是只守开头。
5. **外部防护层**：输入审核、输出审核和供应商规则不等于模型内安全后训练，不能用前四层的结果直接推断。

## 六、最重要的证据边界

- 目前没有论文证明“在输入最前面放一段著名小说，就会因为模型后训练对前缀敏感而稳定解锁能力”。
- 已有强证据证明“输出最前几个 token 对安全轨迹异常重要”；这是相邻命题，不是同一命题。
- 长文本的作用可能是 ICL、文体分布定位、位置偏置、指令遗忘或审核器差异，必须用等长和换位消融区分。
- 角色扮演/小说不是通用钥匙；针对相应分布做过安全训练后，效果可以消失，甚至造成无害内容误拒绝。
- 研究应把“模型内拒绝”“供应商审核”“传输/重试失败”分开计数，否则会把系统现象误判成模型机制。

## 参考资料

1. Qi et al. [Safety Alignment Should Be Made More Than Just a Few Tokens Deep](https://proceedings.iclr.cc/paper_files/paper/2025/file/88be023075a5a3ff3dc3b5d26623fa22-Paper-Conference.pdf), ICLR 2025.
2. Arditi et al. [Refusal in Language Models Is Mediated by a Single Direction](https://proceedings.neurips.cc/paper_files/paper/2024/hash/f545448535dfde4f9786555403ab7c49-Abstract-Conference.html), NeurIPS 2024.
3. Wei et al. [Jailbroken: How Does LLM Safety Training Fail?](https://arxiv.org/abs/2307.02483), 2023.
4. Wei et al. [Jailbreak and Guard Aligned Language Models with Only Few In-Context Demonstrations](https://arxiv.org/abs/2310.06387), 2023.
5. Anil et al. [Many-shot Jailbreaking](https://www.anthropic.com/research/many-shot-jailbreaking), Anthropic, 2024.
6. Liu et al. [Lost in the Middle: How Language Models Use Long Contexts](https://aclanthology.org/2024.tacl-1.9/), TACL 2024.
7. Liu et al. [Instruction Position Matters in Sequence Generation with Large Language Models](https://aclanthology.org/2024.findings-acl.693/), Findings of ACL 2024.
8. Lyu et al. [Keeping LLMs Aligned After Fine-tuning: The Crucial Role of Prompt Templates](https://proceedings.neurips.cc/paper_files/paper/2024/hash/d6f034bb216b472fc7d32ec7aff20342-Abstract-Conference.html), NeurIPS 2024.
9. Li et al. [DeepInception: Hypnotize Large Language Model to Be Jailbreaker](https://arxiv.org/abs/2311.03191), 2023, revised subsequently.
10. Ji et al. [The First Few Tokens Are All You Need: An Efficient and Effective Unsupervised Prefix Fine-Tuning Method for Reasoning Models](https://arxiv.org/abs/2503.02875), 2025.
11. DeepSeek. [Chat Prefix Completion (Beta)](https://api-docs.deepseek.com/guides/chat_prefix_completion/), official API documentation.
