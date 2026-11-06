// UCS CatIDs (Universal Category System); labels are display-only, never identities.
const audioCategories = Object.freeze({
  WEAPSwrd:'刀剑', WEAPArro:'箭矢', WEAPBow:'弓弦', WEAPWhip:'鞭', WEAPBlnt:'钝器',
  MAGSpel:'魔法施放', MAGShim:'魔法闪光', MAGElem:'元素魔法', MAGEvil:'邪异魔法', MAGPoof:'魔法消散',
  FGHTImpt:'击打', FGHTBf:'倒地', FEETHmn:'人物脚步',
  DOORWood:'木门', DOORMetl:'金属门', DOORSlid:'滑门', DOORMisc:'门扉', DOORKnck:'敲门',
  BELLDoor:'门铃', ALRMBell:'警铃与校铃', ALRMElec:'电子警报',
  GUNPis:'手枪', GUNRif:'步枪', GUNAuto:'连射枪械', GUNMech:'枪械装填', GUNMisc:'枪声',
  EXPLDsgn:'设计爆炸', EXPLReal:'真实爆炸',
  DSGNWhsh:'设计破风', DSGNStngr:'情绪提示', DSGNErie:'诡异音色', DSGNRmbl:'低频轰鸣',
  TOONMisc:'卡通效果', HMNHart:'心跳', HMNBrth:'呼吸',
  CLOTHMvmt:'衣料动作', PAPRHndl:'纸张翻动', GLASBrk:'玻璃破碎',
  COMCam:'相机', COMCell:'手机提示', COMMic:'麦克风', CLOCKTick:'时钟滴答',
  WATRSplsh:'水花', WATRFlow:'流水', FIREBurn:'燃烧', ELECZap:'电击', THUN:'雷鸣',
  CRWDCheer:'人群欢呼', CRWDApls:'人群掌声', CRWDConv:'人群交谈',
  MUSCStr:'弦乐试音', MUSCPerc:'打击乐', MUSCStngr:'音乐提示',
  WEAPPole:'长柄武器', WEAPArmr:'盾与盔甲', WEAPMisc:'其他武器', FGHTMisc:'战斗动作（未细分）', MAGMisc:'魔法音色（未细分）',
  BELLLrg:'大钟', BELLHand:'手铃与风铃', MECHSwtch:'机械开关', OBJWrite:'书写', OBJOffc:'办公器具', OBJFurn:'家具动作', OBJCont:'容器动作', OBJMisc:'物品动作',
  VEHCar:'汽车', VEHMisc:'车辆动作', VEHHorn:'车辆喇叭', VEHBrake:'刹车', VEHSirn:'警笛', COMType:'打字机', COMPhono:'唱片', COMStatic:'通讯杂音',
  CHAINMvmt:'链条动作', FOODEat:'咀嚼', FOODTware:'餐具', FOODKware:'厨具', FOODCook:'烹饪', HMNBlow:'吹气', HMNMisc:'身体杂音',
  METLMvmt:'金属动作', METLImpt:'金属撞击', TOOLPneu:'气动工具', TOOLHand:'手工工具', WINDGust:'阵风', WINDTurb:'暴风', ROPEMvmt:'绳线动作',
  WNDWCover:'窗帘与帷幕', VOXLaff:'笑声', MUSCKeyd:'键盘乐器', MUSCChor:'合唱', MUSCToy:'玩具乐器', MECHPuly:'滑轮提升',
  ROCKCrsh:'土石崩塌', ROCKBrk:'石面破裂', DSGNImpt:'设计冲击', ANMLCat:'猫叫', ALRMClok:'闹钟', WHSTHmn:'哨声', WINGBird:'鸟翼拍动', SCIMisc:'科幻效果'
});
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = audioCategories;
