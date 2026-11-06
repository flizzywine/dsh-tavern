/**
 * 自动生图规则：注入模型提示词，让它在正文里分散写出 image###英文Tag### 标记。
 *
 * 规则骨架来自 RP-Hub 的内置内容（经 dsh-rphub-image 整理，MIT）。这里只做了两处适配：
 *   1. 张数上限从 8 收到 6 —— 本地 ComfyUI 一张要几十秒，8 张会让一轮等太久；
 *   2. 补一句"看不出画面的内容不要写"，减少本地模型写空 tag 的概率。
 */

export function buildAutoImageGenPrompt(imageGenCount = 2) {
  const count = Math.min(6, Math.max(1, Number(imageGenCount) || 2))
  return `<auto_image_gen>\n用户已开启自动生图。这条规则只适用于角色扮演与故事正文：如果这一轮是在改卡片设定、写代码、回答设定问题或做调试，就不要输出任何 image### 标记，照常写回复即可。\n每次回复都必须将${count}张图片作为正文插图，按剧情先后分散插入各自对应段落之后，禁止连续输出多个图片或集中放在正文开头、结尾及同一位置。格式为：image###英文Tag###，不得只输出文字正文。
围绕当前剧情中的具体场景和人物生成${count}张画面，每张图选择明确的剧情瞬间、视觉焦点和镜头。所有Tag必须使用英文并以英文逗号分隔，禁止中文Tag；提示词必须详尽、细致且可直接绘制，不得使用笼统省略的Tag或脱离场景拼凑通用画面。
强制按“对应正文段落 → 该段图片 → 后续正文段落”的顺序穿插。第一张图片前、任意两张图片之间及最后一张图片后都必须有非空正文；严禁相邻输出图片、写完正文后再统一补图，或让图片成为整次回复的结尾。输出前必须检查并重排不符合此顺序的图片。
注意：如为nsfw场景，生成的提示词必须带上 nsfw 标签；如果是同人/已有作品角色，角色名仍必须放在最前面，nsfw 紧跟其后。

### 提示词生成指导
先结合当前正文还原画面，再逐项检查人物数量与身份、固定外貌、当下服装、姿势、动作细节、表情与视线、人物/物品/环境交互、镜头构图、地点背景、时间光线及剧情状态；即使画面简单，也不得省略决定人物形象、动作、构图和场景的必要信息。
人物细节、姿势、动作、交互和衣物按下方角色结构组织；镜头必须写明观察方向、取景范围与视觉焦点【如：从下往上的下半身、从上往下的上半身、lower_body,between_legs,between_breasts,pantyshot,looking_at_viewer】，并写明地点【如：diningroom,gym,bedroom,indoors,home,beach】、时间【morning,noon,night】及对应光线。

<Tag_注意事项>
# Tag规范
- 只使用英文Tag，禁用中文。同人/已有作品角色必须把官方英文名或常用角色Tag放在提示词最前面。
- 将复合概念拆成绘图模型能直接理解的独立Tag：【如：月下→moonlight,night】
- 对“不提及也容易生成”的画面元素，使用“no+Tag”明确排除：【如：穿衣但不穿胸罩→no bra；穿短裙但不穿内裤→no panties】

# 可视内容边界
只描述画面中客观可见的人、物、背景和正在发生的物理动作；严禁加入人物内心、回忆、幻想、预告、计划、比喻或其他无法直接画出的内容。根据镜头与遮挡移除不可见或互相冲突的Tag，不要同时描述画面看不到的部位。
写不出具体画面的抽象描述一律不要写；每个Tag都必须对应画面上真实存在的东西。
【如：构图变化：全身→仅下半身→移除"shirt, expression"等上半身Tag】
【如：人物视线：正面→背对→移除"eye color"等面部Tag→再添加：from behind】
【如：遮挡视线：脸庞遮盖/蒙眼→移除"eye color"等眼部Tag，添加：face covered/blindfold】
【如：对话转动作：“你看，我今天穿内裤了。”→撩裙子,可见内裤→lifting skirt,panties】
</Tag_注意事项>

### 角色提示词组织
以Character 1 Prompt为示例。每个清晰入镜的角色都要按下列项目形成独立且完整的描述，不能只写名字或单一特征：
身份：
 - 主体标识：【如：girl、boy、other】
 - 同人角色：提示词第一项必须是英文全名\\(作品名\\)或常用角色Tag（下划线_替换成空格，/转义为\\），再接外貌、服装、动作等Tag
特征：
 - 基础特征：发型、发色、瞳色、罩杯【如：white hair,1girl,1boy】
 - 专属特征：年龄、职业、性格、皮肤、种族及服装特色【如：mesugaki,ojousama,china_dress,gothic,glasses】
**稳定身份特征必须保持一致；仅根据场景、构图和实际可见范围临时移除不可见或冲突的Tag，不得把角色本身的设定改掉。**
互动动作与细节：
  - 姿势与行为【如：standing,on back,on stomach,kneeling,bathing,cooking,fighting,showering,sleeping,spitting,walking,toilet_use,grinding,fingering,licking_penis,spread legs,wariza,sitting_in_tree,lotus_position,sitting_on_rock,sitting_on_stairs,folded,cameltoe】
  - 动作细节【如：hands_on_own_chest,arms_behind_back,penis_grab,pulled_by_self,skirt_pull,clothes_lift,covering_chest_by_hand,finger_to_mouth,hands_on_lap】
  - 自身【如：hands on own ass、grab own ass、arms behind back、covering chest by hand】
  - 对方【如：hand on others' chest 、grabbing another's hair 、penis grab、covering another's eyes、princess carry】
  - 物品【如：holding doorknob、clothes lift、sex toy on floor、bowl in front of girl、dildo in mouth】
  - 环境【如：partially submerged】
  - 衣物细节【如：XX半脱、露出XX】
**同步/非同步：【如：双手举高→raising hands；单手举高→raising hand, hand in pocket】**
表情：
  - 视线：【如：looking at viewer】
  - 面部：【如：open mouth】
  - 表情：【如：smile、blush、crying、tearing_clothes、disgust、angry、kubrick_stare】
  - 生理反应：【wet、pussy juice、cum、dripping】
**画面中每个入镜人物都必须添加符合当前剧情状态的表情Tag，不得省略。**

<Tag_智能调整>
# 完整度与排序：确认每个可见主体和场景信息均已覆盖，再删除重复、不可见或冲突的Tag。按视觉焦点由高到低排序，主体与核心动作最详细，次要背景适度描述，相关Tag相邻；不得为了精简省略决定身份、动作、场景或构图的关键Tag。
# 场景连续性：准确保留人物外貌、着装状态、道具和相对位置。剧情未明确换地点或明显推进时间时，重复相同的地点、时段、天气、光线、背景结构及主要道具等核心环境Tag，只更新正文明确改变的动作、表情和镜头。
# 角色一致性：稳定身份特征不得改变；仅因构图和遮挡临时移除不可见Tag。同人或固定角色使用准确且稳定的专属特征组合，对常驻特征【如：特定发型、异色瞳、专属装饰物】使用最高权重{{{Tag}}}。

<生成格式>
image###英文Tag###
</生成格式>
</Tag_智能调整>

特别提示：出现user或主角参与时，禁止出现主角的脸部和头部；必须使用第一视角(POV）相关提示词，并作为Character Prompt添加。禁止出现用户/主角名字（包括中文、英文、拼音和{{user}}）；同人角色本人的官方角色名仍按上方规则放在最前面。
</auto_image_gen>`
}

export function buildNextResponseImageHint({ enabled = false, imageGenCount = 2 } = {}) {
  if (!enabled) return ''
  return `当前已开启自动生图，请按系统中的自动生图规则生成并插入${Math.min(6, Math.max(1, Number(imageGenCount) || 2))}张图片。`
}
