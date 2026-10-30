'use strict';
// first-party phone mod (iPhone 15 Pro Max look). The host owns hidden/compact/open, attention counts,
// history and timing; this page only paints the accepted, already revealed text it receives.
(() => {
    let token=null,presentation={state:'hidden',suspended:true,attention:{count:0,changed:false}},source=null,settings={},settingAssets={},theme={},playback={},lastEvent=null,hydrated=false,lastCurrent=null;
    // The phone's own Settings (phone-settings.js on the stage): the store's view, the open setting page, request ids.
    let config=null,detail=null,asked=0,configSerial=0;
    const send=(type,data={})=>parent.postMessage({channel:'dsh-widget',version:2,token,type,...data},'*');
    const $=id=>document.getElementById(id),body=document.body,root=document.documentElement.style;
    const phone=$('phone'),messages=$('messages'),island=$('island'),reducedQuery=matchMedia('(prefers-reduced-motion: reduce)');
    const STICKER=/^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\s*){1,3}$/u;
    const ink=hex=>{const rgb=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#000000':'#ffffff';};
    const reduced=()=>presentation.reducedMotion===true || reducedQuery.matches;
    const live=()=>playback.mode==='live' && !playback.skipping && !presentation.suspended;
    function appearance(transitionMs=0) {
        // Paint immediate edits while the existing store acknowledges them.
        const settings=shownSettings();
        // Nine stage tokens arrive already contrast-checked; custom colours only override the matching token.
        const tokens={accent:'--gal-ui-accent',accentText:'--gal-ui-accent-ink',surface:'--gal-ui-surface',surfaceText:'--gal-ui-ink',muted:'--gal-ui-ink-2',border:'--gal-ui-line',fontFamily:'--gal-ui-font',headingFont:'--gal-ui-title-font'};
        root.setProperty('--theme-transition',(reduced()?0:transitionMs)+'ms');
        for(const [key,property] of Object.entries(tokens))if(theme[key]!==undefined)root.setProperty(property,theme[key]);
        if(Number.isFinite(theme.radius))root.setProperty('--gal-ui-radius',theme.radius+'px');
        for(const [key,property] of [['accentColor','--gal-ui-accent'],['surfaceColor','--gal-ui-surface'],['bodyColor','--phone-body']]) {
            const value=settings[key];
            if(/^#[0-9a-f]{6}$/.test(value)) {root.setProperty(property,value);if(key!=='bodyColor')root.setProperty(key==='accentColor'?'--gal-ui-accent-ink':'--gal-ui-ink',ink(value));if(key==='surfaceColor')root.setProperty('--gal-ui-ink-2',ink(value));}
            else if(key==='bodyColor')root.setProperty(property,theme.border || '#3b3a38');
        }
        const clock=settings.clockText ?? '09:41';
        if($('clock').textContent!==clock)$('clock').textContent=clock;
        if($('handover-clock').textContent!==clock)$('handover-clock').textContent=clock;
        $('status-bar').hidden=settings.statusBar===false;
        // Battery (0–100), carrier text and signal bars (0–4) are settings of the mod page (全局 / 本卡); glyphs from battery.js.
        const level=Math.round(Math.max(0,Math.min(100,Number(settings.battery ?? 80) || 0))),battery=$('battery');
        const paint=(node,markup)=>{if(node.forkMarkup!==markup){node.innerHTML=markup;node.forkMarkup=markup;}};
        paint(battery,phoneModBatterySvg(level,'phone-batt'));battery.dataset.level=phoneModBatteryLevel(level);battery.setAttribute('aria-label','装饰电量 '+level+'%');
        const carrier=typeof settings.carrier==='string' ? settings.carrier : '';
        if($('carrier').textContent!==carrier)$('carrier').textContent=carrier;
        paint($('signal'),phoneModSignalSvg(Math.max(0,Math.min(4,Math.round(Number(settings.signal ?? 4) || 0)))));
        paint($('wifi'),phoneModWifiSvg());
        const cutout=['island','notch','none'].includes(settings.cutout) ? settings.cutout : 'island';
        $('cutout').dataset.kind=cutout;body.dataset.cutout=cutout;
        // Unavailable choices use the built-in plain surface without clearing the persistent selection. The home screen
        // shows the wallpaper as it is; Messages shows it under its tint (the lock screen too).
        const wallpaper=settingAssets.wallpaper,wall=wallpaper?.url ? `url(${JSON.stringify(wallpaper.url)})` : '';
        root.setProperty('--wall',wall || 'none');$('handover').style.backgroundImage=wall;
        body.dataset.wallpaper=wall ? 'image' : 'stage';
        // Grouped lists (Settings) follow iOS: light = grey page under white cells, dark = black page under raised cells.
        const probe=getComputedStyle(body).color.match(/[\d.]+/g)?.slice(0,3).map(Number) || [0,0,0];
        body.dataset.scheme=.2126*probe[0]+.7152*probe[1]+.0722*probe[2]>128 ? 'dark' : 'light';
    }
    // Per-character 备注名 / 头像 from the mod settings, keyed by the stage alias; the card's own name and face otherwise.
    const contactName=alias=>{const name=settings.contacts?.[alias]?.name;return typeof name==='string' && name ? name : '';};
    const contactAvatar=alias=>settingAssets['contact:'+alias]?.url || null;
    function setImage(node,url) {
        if(url){if(node.getAttribute('src')!==url)node.src=url;node.hidden=false;}
        else {node.removeAttribute('src');node.hidden=true;}
    }
    const voiceSeconds=text=>Math.max(1,Math.ceil(Array.from(text || '').length/4));
    // ---- thread contract adapter -------------------------------------------------
    // Everything the view reads about threads and groups goes through these few helpers, so
    // the host shape can change without touching the painting code. Without `threads` the phone is the single live
    // conversation it always was (no list, back arrow collapses).
    const PLAYER='$player';
    const threadList=()=>Array.isArray(source?.threads) ? source.threads : null;
    const navigable=()=>Boolean(threadList());
    const shownThread=()=>source?.threadId ? threadList()?.find(thread=>thread.id===source.threadId) || null : null;
    const isGroup=()=>shownThread()?.kind==='group';
    const senderKey=message=>message.sender || message.alias || message.contact || '';
    // 「谁的手机」: whose phone is on screen. The host projects every phone that has a conversation (the player's first)
    // with bubbles relative to its owner; on another person's phone the player is a person like any other.
    const phoneList=()=>Array.isArray(source?.phones) ? source.phones : [];
    const owner=()=>source?.phoneId || PLAYER;
    const personName=person=>contactName(person.id) || (person.id===PLAYER ? source?.playerName || '你' : person.name) || '';
    const ownerLabel=row=>row.id===PLAYER ? '我的手机' : (contactName(row.id) || row.name || '未知联系人')+'的手机';
    const personAvatar=person=>contactAvatar(person.id) || (person.avatar ? source?.avatars?.[person.avatar] || null : null);
    // A bubble without its own mood thumbnail shows the sender's face from the conversation's participants.
    const personOf=id=>{for(const thread of threadList() || [])for(const person of thread.participants || [])if(person.id===id)return person;return null;};
    const senderAvatar=message=>{const id=message.sender || message.contact,person=id ? personOf(id) : null;
        return contactAvatar(id) || source?.avatars?.[message.avatar] || (person ? personAvatar(person) : null);};
    const senderName=message=>contactName(message.sender || message.alias) || message.name || '';
    const others=thread=>(thread?.participants || []).filter(person=>person.id!==owner());
    // The contact card a person in a conversation opens: the player's own phone's contact row, if any.
    const cardOf=person=>person && owner()===PLAYER ? source?.contacts?.find(row=>row.id===person.id) || null : null;
    const threadTitle=thread=>thread.kind==='group' ? thread.name : (others(thread)[0] ? personName(others(thread)[0]) : '') || contactName(thread.id) || thread.name || '未知联系人';
    // Unread counts come from the host (the persisted last-read place of each conversation); the view only reports which
    // conversation is on the open phone's screen.
    const unreadOf=thread=>Number(thread.unread) || 0;
    let readKey='';
    function reportRead() {
        const thread=shownThread(),last=thread?.messages?.at(-1);
        // Only a conversation with unread messages needs reporting, which keeps the bridge quiet while reading.
        const key=presentation.state==='open' && !presentation.suspended && app==='messages' && route==='thread' && !groupInfo && thread && unreadOf(thread) ? thread.id+'|'+(last?.id || '')+'|'+unreadOf(thread) : '';
        if(key && key!==readKey)send('phone.read',{threadId:thread.id,phoneId:owner()});
        readKey=key;
    }
    // ---- navigation (iOS Messages: list → thread → back) --------------------------------------------------------
    // groupInfo: the id of the group whose details are open over its conversation (null when none).
    let route='thread',viewing=null,groupInfo=null;
    function go(next,threadId=null) {
        route=next;viewing=next==='thread' ? threadId : viewing;groupInfo=null;
        if(next==='thread'){send('phone.view',{threadId});}
        render();
        if(next==='thread')messages.scrollTop=messages.scrollHeight;
        requestAnimationFrame(()=>(next==='list' ? $('threads').querySelector(`[data-thread-id="${CSS.escape(threadId || shownThread()?.id || '')}"]`) || $('threads').querySelector('button') : $('toggle'))?.focus({preventScroll:true}));
    }
    const followingLive=()=>app==='messages' && route==='thread' && !groupInfo && (!viewing || viewing===source?.liveThreadId);
    // ---- a real phone's apps: home screen (电话 · 信息 · 设置, the iOS dock
    // order), apps open from their icon with the iOS zoom and close back into it; the home indicator (tap or swipe up) goes
    // home, and on the home screen puts the phone away. Messages is the app the phone opens on; switching phones lives in
    // Settings (account card → list, ✓); 电话 lists who can be called (dialer.js).
    let app='messages',settingsPage='root',motion=null;
    const home=$('home-screen'),apps={phone:$('phone-app'),messages:$('messages-app'),settings:$('settings-app'),photos:$('photos-app')};
    const tileOf=name=>home.querySelector(`[data-app="${name}"] .tile`);
    // Positions in the phone's own (unzoomed) CSS pixels, which is what transforms use.
    function offset(node) {let x=0,y=0;while(node && node!==phone){x+=node.offsetLeft;y+=node.offsetTop;node=node.offsetParent;}return {x,y};}
    function stopMotion() {if(!motion)return;const done=motion;motion=null;for(const animation of done.animations)animation.cancel();}
    function zoom(name,opening) {
        stopMotion();
        const el=apps[name];
        if(presentation.state!=='open' || typeof el.animate!=='function'){render();return;}
        const current={app:name,animations:[]};motion=current;render();
        const tile=tileOf(name),a=offset(el),t=offset(tile),width=el.offsetWidth || 1,height=el.offsetHeight || 1,size=tile.offsetWidth || 1;
        const rest=getComputedStyle(el).borderTopLeftRadius,sx=size/width,sy=size/height,radius=size*.225;
        const icon={transform:`translate(${t.x-a.x}px,${t.y-a.y}px) scale(${sx},${sy})`,borderRadius:`${radius/sx}px / ${radius/sy}px`},full={transform:'none',borderRadius:rest};
        const calm=reduced(),duration=calm ? 160 : opening ? 460 : 400,easing=calm ? 'linear' : opening ? 'cubic-bezier(.2,.85,.25,1)' : 'cubic-bezier(.3,.75,.25,1)';
        const frames=calm ? [{opacity:0},{opacity:1}] : [{...icon,opacity:0},{opacity:1,offset:.3},{...full,opacity:1}];
        const behind=calm ? [{opacity:1},{opacity:1}] : [{transform:'none',opacity:1},{transform:'scale(1.1)',opacity:.4}];
        current.animations=[el.animate(opening ? frames : [...frames].reverse().map((frame,index,list)=>frame.offset===undefined ? frame : {...frame,offset:1-frame.offset}),{duration,easing}),
            home.firstElementChild.animate(opening ? behind : [...behind].reverse(),{duration,easing})];
        current.animations[0].finished.then(()=>{if(motion===current){motion=null;render();}},()=>{});
    }
    function focusApp() {
        // render() has already mounted the page; a deferred focus would steal the next editor's input.
        const target=app==='settings' ? (settingsPage==='accounts' ? ownerMenu.querySelector('[tabindex="0"]') : settingsPage==='scope' ? $('scope-body').querySelector('[tabindex="0"]') : settingsPage==='detail' ? detailBody.querySelector('[tabindex="0"],input,button:not([disabled])') || $('detail-back') : $('account'))
            : app==='messages' ? (route==='list' && navigable() ? $('threads').querySelector('button') || $('list-view').querySelector('.scroll') : groupInfo ? $('group-info-back') : $('toggle'))
            : null;
        if(app==='phone')dialer.focus();else if(app==='photos')photos.focus();else target?.focus({preventScroll:true});
    }
    function openApp(name,animate=true) {
        if(app===name)return;
        const from=app;app=name;if(name==='settings'){settingsPage='root';closeDetail();if(config)ask('load').catch(()=>{});}
        // Who can be called is read afresh each time 电话 opens (a voice set meanwhile, speech recognition started).
        if(name==='phone')send('phone.call',{action:'threads',voices:true});
        if(name==='photos' && config)ask('load').catch(()=>{});
        if(animate && from===null)zoom(name,true);else {stopMotion();render();}
        if(name==='messages' && route==='thread')messages.scrollTop=messages.scrollHeight;
        focusApp();
    }
    function goHome() {
        if(app===null)return;
        const from=app;app=null;zoom(from,false);
        requestAnimationFrame(()=>home.querySelector(`[data-app="${from}"]`)?.focus({preventScroll:true}));
    }
    function showSettingsPage(page) {if(page!=='detail')closeDetail();settingsPage=page;render();focusApp();}
    for(const button of home.querySelectorAll('.app-icon'))button.onclick=()=>openApp(button.dataset.app);
    $('account').onclick=()=>showSettingsPage('accounts');
    $('accounts-back').onclick=()=>showSettingsPage('root');
    $('scope-row').onclick=()=>{renderScope();showSettingsPage('scope');};
    $('scope-back').onclick=()=>showSettingsPage('accounts');
    // Large title → inline title once it scrolls under the bar; the bar gets its material as soon as anything is under it.
    for(const box of document.querySelectorAll('.scroll')){
        const bar=box.previousElementSibling,large=box.querySelector('.large');
        box.addEventListener('scroll',()=>{const top=box.scrollTop,state=large && top>large.offsetTop+large.offsetHeight-8 ? 'title' : top>1 ? 'edge' : '';if(bar.dataset.state!==state)bar.dataset.state=state;},{passive:true});
    }
    // the host sizes the phone (and the banner, as wide as its screen) with the stage; the
    // view keeps the 280-wide design and zooms to that size. The reading sheet stays at 1:1. Messages read at iOS proportions of
    // the phone's width (--pt = one point of a 393 pt iPhone, style.css): on the stage that is the 280 design zoomed with the
    // phone (the text scales with the phone, not with the dialogue box); the sheet
    // is the device's own width.
    function fit() {
        const base=presentation.state==='compact' ? 265 : 280,sheet=presentation.surface==='sheet';
        const zoom=sheet || !innerWidth ? 1 : Math.min(3,Math.max(.7,innerWidth/base));
        const value=String(Math.round(zoom*1000)/1000),style=document.documentElement.style;
        const pt=sheet && innerWidth ? Math.round(innerWidth/393*10000)/10000+'px' : '';
        point=pt ? parseFloat(pt) : 280/393;
        if(style.zoom===value && style.getPropertyValue('--pt')===pt)return;
        // A conversation read to its end stays at its end when the phone or its text changes size.
        const atEnd=messages.scrollHeight-messages.clientHeight-messages.scrollTop<24;
        style.zoom=value;if(pt)style.setProperty('--pt',pt);else style.removeProperty('--pt');
        if(atEnd)messages.scrollTop=messages.scrollHeight;
    }
    let point=280/393; // one iOS point in the view's CSS px (the --pt fit() sets)
    window.addEventListener('resize',fit);
    // A participant's face: their photo, otherwise the first character of their name on a tinted circle. A face the host is
    // still preparing (avatarPending) is a quiet circle without a letter, so the list never shows initials that turn into
    // faces a moment later; the face then fades in on the same spot (faceKey / placeFaces: no reflow).
    const faceKey=person=>personAvatar(person) || (person.avatarPending ? 'pending' : '');
    function face(person,size) {
        const url=personAvatar(person);
        if(url){const image=document.createElement('img');image.alt='';image.src=url;image.width=image.height=size;image.decoding='async';return image;}
        const initial=document.createElement('span');initial.className='initial';
        if(person.avatarPending){initial.classList.add('pending');return initial;}
        initial.textContent=Array.from(personName(person).trim())[0] || '?';
        let hash=0;for(const char of person.id || '')hash=(hash*31+char.codePointAt(0))>>>0;
        initial.style.setProperty('--hue',String(hash%360));return initial;
    }
    // Group picture as iOS Messages draws one without a group photo:
    // a cluster of separate round faces inside the avatar circle, none covering another, the latest speaker largest. Slots
    // are [centre x, centre y, diameter] as fractions of the circle, measured from iOS: three
    // people 46 / 34 / 29 %; at most four slots, more than four people show three faces and a count (+N) in the fourth.
    const CLUSTER={1:[[.5,.5,1]],2:[[.36,.37,.5],[.7,.68,.38]],3:[[.355,.36,.46],[.746,.6,.34],[.44,.78,.29]],4:[[.35,.33,.4],[.73,.4,.3],[.32,.72,.3],[.68,.74,.3]]};
    function stack(node,thread,size) {
        const spoke=new Map();(thread.messages || []).forEach((message,i)=>{if(message.side==='in')spoke.set(senderKey(message),i);});
        const people=others(thread).map((person,i)=>[person,i]).sort((a,b)=>(spoke.get(b[0].id) ?? -1)-(spoke.get(a[0].id) ?? -1) || a[1]-b[1]).map(([person])=>person);
        const more=people.length>4 ? people.length-3 : 0,shown=people.slice(0,more ? 3 : 4);
        if(!shown.length)shown.push({id:thread.id,name:thread.name || ''});
        const key=shown.map(person=>person.id+'|'+faceKey(person)).join(',')+'|'+more+'|'+size;
        if(node.forkKey===key)return;node.forkKey=key;
        const slots=CLUSTER[shown.length+(more ? 1 : 0)],nodes=shown.map((person,i)=>face(person,Math.round(size*slots[i][2])));
        if(more){const count=document.createElement('span');count.className='initial more';count.textContent='+'+more;nodes.push(count);}
        nodes.forEach((child,i)=>{const [x,y,d]=slots[i];Object.assign(child.style,{left:(x-d/2)*100+'%',top:(y-d/2)*100+'%',width:d*100+'%',height:d*100+'%',fontSize:Math.max(6,Math.round(size*d*(child.classList.contains('more') ? .4 : .46)))+'px'});});
        placeFaces(node,nodes);node.dataset.count=String(nodes.length);
    }
    function placeFaces(node,faces) {
        const waited=[...node.children].map(child=>child.classList.contains('pending'));
        node.replaceChildren(...faces);
        faces.forEach((child,i)=>{if(waited[i] && child.tagName==='IMG')child.classList.add('arrive');});
    }
    function makeRow(message) {
        const row=document.createElement('article'),image=document.createElement('img'),column=document.createElement('div'),sender=document.createElement('small'),bubble=document.createElement('div'),text=document.createElement('p'),play=document.createElement('button'),note=document.createElement('small');
        row.dataset.messageId=message.id;image.alt='';image.width=image.height=28;image.decoding='async';
        column.className='column';sender.className='sender';bubble.className='bubble';
        play.type='button';play.className='voice';play.setAttribute('aria-label','\u91cd\u64ad\u8bed\u97f3');play.title='\u91cd\u64ad\u8bed\u97f3';
        play.innerHTML='<svg viewBox="0 0 9 10" aria-hidden="true"><path d="M0 0v10l9-5z"/></svg><i></i><i></i><i></i><i></i><i></i>';
        play.onclick=()=>send('voice.replay',{handle:row.dataset.voice});
        note.className='note';note.textContent='\u26a0 \u5168\u6587\u89c1\u5c65\u5386';
        const transcript=document.createElement('button'),duration=document.createElement('span');
        transcript.type='button';transcript.className='transcript-toggle';transcript.textContent='文字';
        transcript.onclick=()=>send('transcript.toggle',{id:row.dataset.messageId});
        duration.className='duration';
        bubble.append(text,play,duration,transcript);column.append(sender,bubble);row.append(image,column,note);
        row.addEventListener('animationend',()=>row.classList.remove('enter','sent'));
        return row;
    }
    function render() {
        const state=presentation.state,lines=source?.messages || [],last=lines.at(-1),contact=last?.contact;
        // Putting the phone away forgets the reader's choices: it comes back out as the reader's own phone, in Messages.
        if(state!=='open' && (route!=='thread' || viewing || switched || app!=='messages' || settingsPage!=='root' || motion || groupInfo)){route='thread';app='messages';settingsPage='root';groupInfo=null;closeDetail();confirmBox.hidden=true;stopMotion();if(viewing || switched){viewing=null;switched=false;send('phone.view',{threadId:null,phoneId:null});}}
        if(state!=='open'){endHandover();endHint();dialer.reset();photos.reset();}else maybeHint();
        // Opened with no conversation in the story (the reader took it out, or it was put away and taken out again): the list,
        // never an empty conversation titled 「未知联系人」.
        if(state==='open' && route==='thread' && !viewing && navigable() && !source?.threadId)route='list';
        const list=route==='list' && navigable(),inMessages=app==='messages' || motion?.app==='messages';
        // On a real phone the sheet is the device itself (presentation.device): no frame, island or status bar of ours, and the
        // home bar clear of the system gesture zone by the device's safe-area insets (a sandboxed frame reads none of its own).
        const device=presentation.surface==='sheet' && presentation.device?.kind==='phone' ? presentation.device : null;
        if(device){body.dataset.device='phone';body.style.setProperty('--safe-top',(device.safe?.top || 0)+'px');body.style.setProperty('--safe-bottom',(device.safe?.bottom || 0)+'px');}
        else{delete body.dataset.device;body.style.removeProperty('--safe-top');body.style.removeProperty('--safe-bottom');}
        body.dataset.presentation=state;body.dataset.surface=presentation.surface==='sheet'?'sheet':'stage';body.dataset.motion=reduced()?'reduced':'full';body.dataset.route=list?'list':'thread';body.dataset.app=app || 'home';body.dataset.source=source ? 'ready' : 'waiting';fit();
        home.hidden=!(app===null || motion);
        for(const [name,node] of Object.entries(apps))node.hidden=!(app===name || motion?.app===name);
        apps.settings.dataset.page=settingsPage;
        const homeLabel=app ? '\u4e3b\u5c4f\u5e55' : '\u6536\u8d77\u624b\u673a';
        if($('home').getAttribute('aria-label')!==homeLabel){$('home').setAttribute('aria-label',homeLabel);$('home').title=homeLabel;}
        $('list-view').hidden=!list;$('thread-view').hidden=list;
        const current=source?.current ? lines.find(row=>row.id===source.current.id) : null;
        const pending=Boolean(current && live() && source.current.revealed===false);
        const typingIn=pending && current.side==='in',composing=pending && current.side==='out' && state==='open';
        const thread=shownThread(),group=isGroup();
        // The details belong to the group on screen: another conversation, the list or a one-to-one closes them.
        if(groupInfo && (list || !group || thread.id!==groupInfo))groupInfo=null;
        // No conversation at all yet (its directory still loading): the app's own name, not a made-up contact.
        const name=(thread ? threadTitle(thread) : contactName(contact)) || (lines.length ? source?.contactName || '未知联系人' : '信息');
        const peer=lines.findLast(row=>row.side==='in' && row.contact===contact && source?.avatars?.[row.avatar]);
        const avatar=group ? null : (thread ? others(thread).map(personAvatar).find(Boolean) : contactAvatar(contact)) || (peer ? source.avatars[peer.avatar] : null);
        if($('contact').textContent!==name)$('contact').textContent=name;
        setImage($('head-avatar'),avatar);
        $('head-group').hidden=!group;if(group)stack($('head-group'),thread,Math.round(60*point));
        const count=group ? '('+thread.participants.length+')' : '';
        if($('member-count').textContent!==count)$('member-count').textContent=count;
        $('member-count').hidden=!group;
        renderBack();renderOwners();
        const callee=!group && thread && owner()===PLAYER ? others(thread)[0] : null;
        const cardContact=cardOf(callee);
        $('thread-contact').disabled=!(cardContact || group);
        $('thread-contact').setAttribute('aria-label',group ? '查看'+name+'的群组详细信息' : cardContact ? '查看'+name+'的联系人卡片' : name);
        renderGroupInfo(group ? thread : null);
        $('call-button').hidden=!(callable(callee?.id) && callee.id!==PLAYER && state==='open' && !list);
        if(app==='phone' || motion?.app==='phone')dialer.render({contacts:source?.contacts,call,own:owner()===PLAYER,video:Boolean(settings.callVideo)});
        if(list)renderList();
        // The conversation is only kept up to date while Messages is on screen (a hidden box cannot hold its scroll place).
        else if(inMessages || state!=='open')renderThread(lines,current,typingIn,composing);
        // The outgoing story line is typed into the composer while the host reveals it, then it is sent.
        const draft=composing ? current.text : '';
        if($('draft').textContent!==draft)$('draft').textContent=draft;
        $('field').classList.toggle('typing',composing);$('send').classList.toggle('ready',composing && Boolean(draft));
        renderIsland(last,name,avatar,typingIn,current);
        // Loading earlier history is a spinner after 150 ms; what the phone truly cannot show is the thread's first row.
        const status=$('history-status');
        status.dataset.kind=source?.historyStatus || 'ready';
        status.hidden=state!=='open' || source?.historyStatus!=='loading' || list;
        lastCurrent=current?.id || null;hydrated=true;
        reportRead();
    }
    // The back arrow returns to the list (with the other threads' unread count, as on iOS); without a list it collapses.
    function renderBack() {
        const back=$('toggle'),label=navigable() ? '\u8fd4\u56de\u4fe1\u606f' : '\u6536\u8d77';
        if(back.getAttribute('aria-label')!==label){back.setAttribute('aria-label',label);back.title=label;}
        const count=navigable() ? threadList().filter(thread=>thread.id!==shownThread()?.id).reduce((sum,thread)=>sum+unreadOf(thread),0) : 0;
        const badge=count ? (count>99 ? '99+' : String(count)) : '';
        if($('back-badge').textContent!==badge)$('back-badge').textContent=badge;
        $('back-badge').hidden=!badge;
    }
    // ---- 「谁的手机」 ------------------------------
    // Whose phone it is reads where a real phone shows it: Settings' account card (face, name, 「爱音的手机」) and, when the
    // phone changes hands, that phone's lock screen. Switching is in Settings: the card opens the list of phones (the
    // reader's own first; face · name · unread count · ✓; ↑↓ Home End move, Enter/Space or a tap switches).
    let pendingPhone=null,switched=false,shownPhoneId=null;
    const ownerMenu=$('owner-menu'),handover=$('handover');
    const phonePerson=row=>({id:row.id,name:row.name,avatar:row.avatar,avatarPending:row.avatarPending});
    function paintFace(node,row,size) {
        const person=phonePerson(row),key=row.id+'|'+faceKey(person)+'|'+personName(person);
        if(node.forkKey!==key){node.forkKey=key;placeFaces(node,[face(person,size)]);}
    }
    const countText=count=>count>99 ? '99+' : String(count);
    function badge(node,count) {const text=count>0 ? countText(count) : '';if(node.textContent!==text)node.textContent=text;node.hidden=!text;}
    function renderOwners() {
        // Without other owners (or before the host lists any) the list is just the reader's own phone.
        const listed=phoneList(),phones=listed.length ? listed : [{id:PLAYER,name:'',unread:0}];
        const current=phones.find(row=>row.id===owner()) || phones[0];
        // Faces can arrive after the line (thumbnails are made on demand); the lock screen picks them up.
        if(!handover.hidden)paintFace($('handover-face'),current,52);
        // Home screen badges: this phone's unread messages on 信息; the other phones' on 设置 (as iOS badges Settings
        // from the account card).
        const mine=navigable() ? threadList().reduce((sum,thread)=>sum+unreadOf(thread),0) : 0;
        const elsewhere=phones.filter(row=>row.id!==current.id).reduce((sum,row)=>sum+(Number(row.unread) || 0),0);
        for(const [name,count] of [['messages',mine],['settings',elsewhere]]){
            const button=home.querySelector(`[data-app="${name}"]`),label=(name==='messages' ? '\u4fe1\u606f' : '\u8bbe\u7f6e')+(count ? '\uff0c'+countText(count)+' \u6761\u672a\u8bfb' : '');
            badge(button.querySelector('.badge'),count);
            if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
        }
        // The account card: the holder's face and name, and whose phone this is.
        const mineNow=current.id===PLAYER,name=mineNow ? source?.playerName || ownerLabel(current) : personName(phonePerson(current)) || '\u672a\u77e5\u8054\u7cfb\u4eba',sub=ownerLabel(current)===name ? '' : ownerLabel(current);
        if($('account-name').textContent!==name)$('account-name').textContent=name;
        if($('account-sub').textContent!==sub)$('account-sub').textContent=sub;
        $('account-sub').hidden=!sub;
        paintFace($('account-face'),current,44);badge($('account-badge'),elsewhere);
        const cardLabel=[name,sub,elsewhere ? '\u5176\u4ed6\u624b\u673a '+countText(elsewhere)+' \u6761\u672a\u8bfb' : ''].filter(Boolean).join('\uff0c');
        if($('account').getAttribute('aria-label')!==cardLabel)$('account').setAttribute('aria-label',cardLabel);
        const existing=new Map([...ownerMenu.children].map(node=>[node.dataset.phoneId,node]));
        for(const [id,node] of existing)if(!phones.some(row=>row.id===id))node.remove();
        const focused=ownerMenu.contains(document.activeElement);
        phones.forEach((row,index)=>{
            let node=existing.get(row.id);
            if(!node){
                node=document.createElement('button');node.type='button';node.className='owner-item';node.setAttribute('role','radio');node.dataset.phoneId=row.id;
                node.innerHTML='<span class="owner-face" aria-hidden="true"></span><span class="owner-label"></span><span class="badge" aria-hidden="true" hidden></span><svg class="owner-check" viewBox="0 0 14 11" aria-hidden="true"><path d="M1.5 5.8 5.2 9.3 12.5 1.7"/></svg>';
                node.onclick=()=>switchPhone(node.dataset.phoneId);
            }
            const [pic,text,count]=node.children,itemLabel=ownerLabel(row),unread=Number(row.unread) || 0,checked=row.id===current.id;
            if(text.textContent!==itemLabel)text.textContent=itemLabel;
            paintFace(pic,row,30);badge(count,unread);
            node.setAttribute('aria-checked',String(checked));
            if(!focused)node.tabIndex=checked ? 0 : -1;
            node.setAttribute('aria-label',itemLabel+(unread ? '\uff0c'+countText(unread)+' \u6761\u672a\u8bfb' : ''));
            if(ownerMenu.children[index]!==node)ownerMenu.insertBefore(node,ownerMenu.children[index] || null);
        });
    }
    // The phone changing hands: it swings in from the side locked, its lock screen (face, 「爱音的手机」, the time), then
    // the lock screen slides up. While the open phone plays live, or at once when the reader switches; a tap skips it.
    // CSS times it (animationend).
    function handOver(row,manual=false) {
        if(!row || presentation.state!=='open' || !(live() || manual && !presentation.suspended))return;
        const label=ownerLabel(row);
        if($('handover-name').textContent!==label)$('handover-name').textContent=label;
        paintFace($('handover-face'),row,52);
        handover.hidden=false;handover.classList.remove('run');phone.classList.remove('handover');void phone.offsetWidth;
        handover.classList.add('run');phone.classList.add('handover');
    }
    function endHandover() {
        if(!handover.hidden){handover.hidden=true;handover.classList.remove('run');}
        phone.classList.remove('handover');
    }
    handover.addEventListener('animationend',event=>{if(event.target===handover && /^unlock/.test(event.animationName))endHandover();});
    phone.addEventListener('animationend',event=>{if(event.target===phone)phone.classList.remove('handover');});
    handover.onclick=event=>{event.stopPropagation();endHandover();};
    // A switch hands over that phone, unlocked to its home screen; the host keeps the choice until the story brings a new
    // phone line (which opens Messages on whichever phone receives it).
    function switchPhone(id) {
        if(!id || id===owner())return;
        pendingPhone=id;switched=true;
        send('phone.view',{threadId:null,phoneId:id});
    }
    // A radio group: one Tab stop on the checked phone, arrows move, Enter/Space (the button) switches.
    ownerMenu.onkeydown=event=>{
        const items=[...ownerMenu.children],at=items.indexOf(document.activeElement);
        const move=index=>{event.preventDefault();const next=items[Math.max(0,Math.min(items.length-1,index))];if(!next)return;for(const item of items)item.tabIndex=item===next ? 0 : -1;next.focus({preventScroll:true});};
        if(event.key==='ArrowDown' || event.key==='ArrowRight')move(at+1);else if(event.key==='ArrowUp' || event.key==='ArrowLeft')move(at-1);
        else if(event.key==='Home')move(0);else if(event.key==='End')move(items.length-1);
    };
    ownerMenu.addEventListener('focusout',event=>{if(!ownerMenu.contains(event.relatedTarget))requestAnimationFrame(render);});
    // Settings uses the existing two-layer store; scope selection never writes a value.
    const prefs=$('prefs'),detailBody=$('detail-body'),confirmBox=$('confirm'),waiting=new Map();
    let settingScope='card',writeSerial=0,settingsError=null,pickerReturn=null;
    const pendingSettings=new Map();
    // Inset groups without header text: appearance, status bar, sound.
    const PREF_GROUPS=[['wallpaper','accentColor','surfaceColor','bodyColor','cutout'],['statusBar','clockText','carrier','signal','battery'],['sound']];
    const PREF_ICONS={wallpaper:'M3 4.5h14v11H3zM3 13l4-4 3 3 2.5-2.5L17 14M12.5 7.5h.01',accentColor:'M10 3a7 7 0 1 0 0 14c1 0 1.5-.7 1.5-1.4 0-1.2-1-2.4 0-.8.6-1.2 1.4-1.2H14a3 3 0 0 0 3-3C17 5.7 13.9 3 10 3zM6.5 9.5h.01M8.5 6.5h.01M12 6.5h.01',
        surfaceColor:'M4 4h12v12H4zM4 9h12',bodyColor:'M6.5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V4a1.5 1.5 0 0 1 1.5-1.5zM8.5 4.5h3',cutout:'M3 6.5a3.5 3.5 0 0 1 3.5-3.5h7A3.5 3.5 0 0 1 17 6.5M7.5 6h5',
        statusBar:'M3 4h14M3 8h9M3 12h14M3 16h6',clockText:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 6.5V10l2.5 1.5',carrier:'M10 9v8M6.5 5.5a5 5 0 0 1 7 0M4 3a8.5 8.5 0 0 1 12 0M10 9h.01',
        signal:'M4 15v-2M8 15v-4.5M12 15V8M16 15V5',battery:'M3 6.5h12v7H3zM17 9v2M5 8.5h5v3H5z',sound:'M6 13V9a4 4 0 0 1 8 0v4l1.2 1.5H4.8zM8.5 16.5h3'};
    const fieldOf=key=>config?.fields?.find(field=>field.key===key) || null;
    const valueOf=key=>config?.values?.[key] || null;
    const labelOf=key=>key==='wallpaper' ? '墙纸' : fieldOf(key)?.label || '';
    const svgIcon=path=>'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="'+path+'"/></svg>';
    const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
    const hex=value=>typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    const hsl=(h,s,l)=>{const f=n=>{const k=(n+h/30)%12,c=l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(255*c).toString(16).padStart(2,'0');};return '#'+f(0)+f(8)+f(4);};
    const SWATCHES={accentColor:()=>[355,18,38,140,168,192,212,236,262,288,318,336].map(h=>hsl(h,.62,.52)),
        surfaceColor:()=>[[40,.2,.98],[42,.32,.93],[214,.3,.95],[340,.32,.95],[140,.22,.94],[258,.08,.16],[214,.1,.11],[0,0,.06]].map(v=>hsl(...v)),
        bodyColor:()=>[[30,.04,.23],[38,.08,.62],[40,.1,.88],[214,.22,.36],[338,.16,.56],[150,.14,.33],[44,.36,.62],[0,0,.07]].map(v=>hsl(...v))};
    const autoOf=key=>config?.autos?.[key] ?? (valueOf(key)?.kind==='auto' ? valueOf(key).value : fieldOf(key)?.default);
    const draftValue=(key,draft)=>draft?.auto ? autoOf(key) : draft?.fixed;
    const sameDraft=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    function layerHolds(key,layer) {
        const v=valueOf(key),field=fieldOf(key);
        if(key==='wallpaper')return config.walls.find(row=>row.layer===layer && row.shown)?.id || (v && Object.hasOwn(v,layer) || layer==='global' ? 'none' : undefined);
        if(v && Object.hasOwn(v,layer))return v[layer];
        return layer==='global' ? (field?.auto ? {auto:true} : {fixed:field?.default}) : undefined;
    }
    function scopedDraft(key,layer=settingScope) {
        const pending=pendingSettings.get(layer+':'+key);
        if(pending)return pending.value;
        return layerHolds(key,layer) ?? layerHolds(key,'global');
    }
    function shownSettings() {
        let shown={...settings};
        if(config?.status==='ready')for(const [key,row] of Object.entries(config.values))if(key!=='wallpaper' && row.value!==null && row.value!==undefined)shown[key]=row.value;
        for(const [id,pending] of pendingSettings){
            const [layer,key]=id.split(':');
            if(key==='wallpaper' || layer==='global' && valueOf(key)?.card!==undefined)continue;
            const value=draftValue(key,pending.value);
            if(value!==undefined)shown={...shown,[key]:value};
        }
        return shown;
    }
    function ask(op,data={}) {
        const requestId='s'+(++asked);send('phone.settings',{requestId,op,...data});
        return new Promise((resolve,reject)=>waiting.set(requestId,{resolve,reject}));
    }
    // The adapter serializes CAS writes. Keep the newest local edit while older acknowledgements arrive.
    async function writeSetting(key,value,layer=settingScope) {
        const id=layer+':'+key,serial=++writeSerial;
        pendingSettings.set(id,{value,serial});settingsError=null;
        if(detail?.key===key)detail.draft=scopedDraft(key);
        appearance();renderPrefs();renderDetailState();
        try {await ask('save',key==='wallpaper' ? {key,layer,choice:value} : {key,layer,value});}
        catch(error){if(pendingSettings.get(id)?.serial===serial){settingsError={text:labelOf(key)+'：'+(error.message || '无法更改设置'),retry:()=>writeSetting(key,value,layer)};if(detail?.key===key && document.activeElement?.matches('.field-input,.slider'))document.activeElement.blur();}}
        finally {
            if(pendingSettings.get(id)?.serial===serial)pendingSettings.delete(id);
            if(detail?.key===key)detail.draft=scopedDraft(key);
            appearance();renderPrefs();renderDetail();
        }
    }
    // where Settings saves is a rarely changed choice, so it is one row in
    // 「切换手机」 (「设置适用于  仅此角色卡 ›」) opening an iOS selection list with a ✓ and one footnote — never a segmented
    // control on every page. Choosing only selects the layer later changes write to; it never writes a value.
    const SCOPES=[['card','仅此角色卡'],['global','所有角色卡']];
    function renderScope() {
        $('scope-group').hidden=!config || config.status!=='ready';
        const label=SCOPES.find(([layer])=>layer===settingScope)[1];
        if($('scope-value').textContent!==label)$('scope-value').textContent=label;
        $('scope-row').setAttribute('aria-label','设置适用于，'+label);
        const body=$('scope-body'),focused=body.contains(document.activeElement);
        body.replaceChildren(checklist('设置适用于',SCOPES.map(([value,text])=>({value,label:text})),settingScope,value=>{settingScope=value;settingsError=null;if(detail)detail.draft=scopedDraft(detail.key);renderScope();renderPrefs();}));
        if(focused)body.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
    }
    function errorNode() {
        const line=make('div','prefs-status');line.setAttribute('role','alert');
        line.append(make('span','',settingsError.text+'。'));
        const retry=make('button','link','重试');retry.type='button';retry.onclick=settingsError.retry;line.append(retry);return line;
    }
    function valueNode(key) {
        const field=fieldOf(key),draft=scopedDraft(key),value=draftValue(key,draft),box=make('span','pref-value');
        if(key==='wallpaper'){const row=[...config.walls,...(config.photos || [])].find(w=>w.id===draft);if(row?.url){const image=make('img','pref-thumb');image.alt='';image.src=row.url;box.append(image);}else box.textContent='默认';}
        else if(field.type==='colour'){const dot=make('i','pref-dot');dot.style.background=hex(value) || 'transparent';box.append(dot);if(draft?.auto)box.append(make('span','','自动'));}
        else if(draft?.ref || draft?.formula)box.textContent='跟随变量';
        else if(field.type==='choice')box.textContent=field.choices.find(row=>row.value===value)?.label || '';
        else if(field.type==='number')box.textContent=value==null ? '' : value+(field.unit==='%' ? '%' : '');
        else box.textContent=draft?.auto ? '自动' : value ? String(value) : '无';
        return box;
    }
    function renderPrefs() {
        prefs.hidden=!config;renderScope();if(!config)return;
        const focused=document.activeElement?.closest?.('#prefs [data-focus]')?.dataset.focus;
        if(config.status!=='ready'){
            const line=make('p','prefs-status');line.setAttribute('role','status');
            if(config.status==='error'){line.textContent='无法载入设置。';const again=make('button','link','重试');again.type='button';again.onclick=()=>ask('load').catch(()=>{});line.append(again);}
            else {line.classList.add('is-loading');line.append(make('i','spin'),make('span','','正在载入…'));}
            prefs.replaceChildren(line);return;
        }
        const groups=[];
        for(const keys of PREF_GROUPS){
            const group=make('div','group prefs-group');
            for(const key of keys.filter(fieldOf)){
                const main=make('button','pref-main'),row=make('div','pref');row.dataset.key=key;main.type='button';main.dataset.focus='pref:'+key;
                const icon=make('span','pref-icon');icon.dataset.key=key;icon.innerHTML=svgIcon(PREF_ICONS[key]);
                // iOS: a binary setting is a switch in its row and applies on toggle; everything else pushes a page.
                if(fieldOf(key).type==='boolean'){
                    const on=draftValue(key,scopedDraft(key))!==false;main.classList.add('switch-row');main.setAttribute('role','switch');main.setAttribute('aria-checked',String(on));
                    main.append(icon,make('span','pref-label',labelOf(key)),make('i','switch'));main.onclick=()=>void writeSetting(key,{fixed:!on});row.append(main);group.append(row);continue;
                }
                const chev=make('span','chev');chev.setAttribute('aria-hidden','true');chev.innerHTML='<svg viewBox="0 0 8 13"><path d="M1.5 1.5 6.5 6.5l-5 5"/></svg>';
                main.append(icon,make('span','pref-label',labelOf(key)),valueNode(key),chev);main.onclick=()=>openDetail(key);row.append(main);group.append(row);
            }
            if(group.children.length)groups.push(group);
        }
        const own=settingScope==='card' ? FIELD_KEYS().filter(key=>valueOf(key)?.card!==undefined) : [];
        if(own.length){
            const group=make('div','group'),reset=make('button','row-action','使用所有角色卡的设置');reset.type='button';reset.dataset.focus='reset-card';
            reset.onclick=()=>confirmAsk('移除此角色卡的全部单独设置？各项将改用所有角色卡的设置。','移除单独设置',async()=>{try{for(const key of own)await ask('clear',{key,layer:'card'});settingsError=null;}catch(error){settingsError={text:error.message,retry:()=>reset.click()};}appearance();renderPrefs();});
            group.append(reset);groups.push(group);
        }
        if(settingsError)groups.push(errorNode());
        prefs.replaceChildren(...groups);
        if(focused)prefs.querySelector('[data-focus="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
    }
    const FIELD_KEYS=()=>PREF_GROUPS.flat().filter(fieldOf);
    function clearSetting() {
        const key=detail.key,layer=settingScope;
        const run=async()=>{try{await ask('clear',{key,layer});settingsError=null;}catch(error){settingsError={text:error.message,retry:run};}if(detail?.key===key)detail.draft=scopedDraft(key);appearance();renderPrefs();renderDetail();};
        run();
    }
    let confirmAction=null,confirmReturn=null;
    function syncSettingsInert() {
        const modal=!confirmBox.hidden || !$('wallpaper-picker').hidden;
        $('settings-detail').inert=modal;$('settings-root').inert=modal;$('wallpaper-picker').inert=!confirmBox.hidden;
    }
    function confirmAsk(text,label,action) {
        confirmAction=action;confirmReturn=document.activeElement;
        $('confirm-text').textContent=text;$('confirm-ok').textContent=label;confirmBox.hidden=false;
        syncSettingsInert();
        requestAnimationFrame(()=>$('confirm-cancel').focus({preventScroll:true}));
    }
    function confirmClose(run) {
        const action=confirmAction;confirmAction=null;confirmBox.hidden=true;syncSettingsInert();
        if(confirmReturn?.isConnected)confirmReturn.focus({preventScroll:true});if(run && action)action();
    }
    $('confirm-ok').onclick=()=>confirmClose(true);$('confirm-cancel').onclick=()=>confirmClose(false);
    confirmBox.onclick=event=>{if(event.target===confirmBox)confirmClose(false);};
    confirmBox.onkeydown=event=>{if(event.key==='Tab'){event.preventDefault();(document.activeElement===$('confirm-ok') ? $('confirm-cancel') : $('confirm-ok')).focus();}};
    function openDetail(key) {
        if(!fieldOf(key))return;
        detail={key,draft:scopedDraft(key),pickerView:'main'};
        settingsPage='detail';renderDetail();appearance();render();$('settings-detail').querySelector('.scroll').scrollTop=0;focusApp();
    }
    function closeDetail() {closeWallpaperPicker();if(!confirmBox.hidden)confirmClose(false);detail=null;appearance();}
    function checklist(label,options,current,choose) {
        const group=make('div','group checklist');group.setAttribute('role','radiogroup');group.setAttribute('aria-label',label);
        for(const option of options){
            const row=make('button','check-row');row.type='button';row.setAttribute('role','radio');
            const on=sameDraft(option.value,current);row.setAttribute('aria-checked',String(on));row.tabIndex=on ? 0 : -1;row.dataset.focus='opt:'+JSON.stringify(option.value);
            if(option.glyph){const glyph=make('span','check-glyph');glyph.innerHTML=option.glyph;row.append(glyph);}
            row.append(make('span','check-label',option.label));if(option.note)row.append(make('span','check-note',option.note));
            const mark=make('span','check-mark');mark.innerHTML='<svg viewBox="0 0 14 11" aria-hidden="true"><path d="M1.5 5.8 5.2 9.3 12.5 1.7"/></svg>';row.append(mark);row.disabled=!!option.disabled;row.onclick=()=>choose(option.value);group.append(row);
        }
        if(!options.some(option=>sameDraft(option.value,current)) && group.firstChild)group.firstChild.tabIndex=0;
        group.onkeydown=event=>{const rows=[...group.children].filter(row=>!row.disabled),at=rows.indexOf(document.activeElement);let next;
            if(['ArrowDown','ArrowRight'].includes(event.key))next=at+1;else if(['ArrowUp','ArrowLeft'].includes(event.key))next=at-1;else if(event.key==='Home')next=0;else if(event.key==='End')next=rows.length-1;
            if(next!==undefined){event.preventDefault();const target=rows[Math.max(0,Math.min(rows.length-1,next))];for(const row of rows)row.tabIndex=row===target ? 0 : -1;target.focus({preventScroll:true});}};
        return group;
    }
    function choose(value) {if(!detail)return;const key=detail.key;detail.draft=value;void writeSetting(key,value);renderDetail();}
    function swatches(key,field) {
        const v=valueOf(key),list=SWATCHES[key](),saved=[v?.card?.fixed,v?.global?.fixed].map(hex).filter(Boolean),colours=[...new Set([...saved,...list])];
        const group=make('div','group swatches');group.setAttribute('role','radiogroup');group.setAttribute('aria-label',field.label);
        for(const colour of colours){const button=make('button','swatch');button.type='button';button.setAttribute('role','radio');const on=sameDraft({fixed:colour},detail.draft);button.setAttribute('aria-checked',String(on));button.setAttribute('aria-label',colour.toUpperCase());button.tabIndex=on ? 0 : -1;button.dataset.focus='colour:'+colour;const dot=make('i');dot.style.background=colour;button.append(dot);button.onclick=()=>choose({fixed:colour});group.append(button);}
        if(!group.querySelector('[tabindex="0"]'))group.firstChild.tabIndex=0;
        group.onkeydown=event=>{const items=[...group.children],at=items.indexOf(document.activeElement),delta={ArrowRight:1,ArrowLeft:-1,ArrowDown:5,ArrowUp:-5}[event.key];if(delta!==undefined){event.preventDefault();const next=items[Math.max(0,Math.min(items.length-1,at+delta))];items.forEach(item=>item.tabIndex=item===next ? 0 : -1);next.focus();}};
        return group;
    }
    function switchGroup(label,on,change) {
        const group=make('div','group'),row=make('button','switch-row');row.type='button';row.setAttribute('role','switch');row.setAttribute('aria-checked',String(on));row.dataset.focus='switch';row.append(make('span','check-label',label),make('i','switch'));row.onclick=()=>change(!on);group.append(row);return group;
    }
    function textField(key,field) {
        const nodes=[],draft=detail.draft,fixed=draft && Object.hasOwn(draft,'fixed');
        if(field.auto)nodes.push(switchGroup('自动',!!draft?.auto,on=>choose(on ? {auto:true} : {fixed:String(valueOf(key)?.value ?? field.default ?? '')})));
        if(!draft?.auto){
            const group=make('div','group'),cell=make('label','field-cell'),input=make('input','field-input');
            input.type='text';input.maxLength=key==='clockText' ? 16 : 64;input.value=fixed ? String(draft.fixed ?? '') : '';input.placeholder=key==='carrier' ? '不显示' : '';input.dataset.focus='text';input.setAttribute('aria-label',field.label);input.spellcheck=false;input.autocomplete='off';
            input.oninput=event=>{if(!event.isComposing)void writeSetting(key,{fixed:input.value});};input.oncompositionend=()=>void writeSetting(key,{fixed:input.value});
            input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}};
            input.onblur=()=>requestAnimationFrame(()=>{if(detail?.key===key)renderDetail();});cell.append(input);group.append(cell);nodes.push(group);
        }
        return nodes;
    }
    function slider(key,field) {
        const group=make('div','group'),cell=make('label','slider-cell'),track=make('input','slider'),out=make('output','slider-value');
        track.type='range';track.min=field.min ?? 0;track.max=field.max ?? 100;track.step=5;track.value=Number(detail.draft?.fixed ?? valueOf(key)?.value ?? track.min);track.dataset.focus='slider';track.setAttribute('aria-label',field.label);
        const paint=()=>{out.textContent=track.value+(field.unit==='%' ? '%' : '');track.setAttribute('aria-valuetext',out.textContent);track.style.setProperty('--position',((track.value-track.min)/(track.max-track.min))*100+'%');};
        track.onpointerdown=()=>track.classList.add('dragging');track.onpointerup=()=>{track.classList.remove('dragging');};track.onpointercancel=()=>track.classList.remove('dragging');
        track.oninput=()=>{paint();void writeSetting(key,{fixed:Number(track.value)});};track.onblur=()=>requestAnimationFrame(()=>{if(detail?.key===key)renderDetail();});paint();cell.append(track,out);group.append(cell);return group;
    }
    function wallpaperPage() {
        const rows=[...config.walls,...(config.photos || [])],picked=rows.find(row=>row.id===detail.draft),card=make('div','group wallpaper-card'),pair=make('div','wall-preview');
        pair.setAttribute('aria-label','锁定屏幕与主屏幕预览');
        for(const kind of ['lock','home']){
            const screen=make('div','mini');screen.dataset.kind=kind;if(picked?.url){screen.style.backgroundImage=`url(${JSON.stringify(picked.url)})`;screen.dataset.image='';}
            if(kind==='lock'){screen.append(make('span','mini-clock',shownSettings().clockText ?? '09:41'));}
            else {const icons=make('span','mini-icons');for(let i=0;i<16;i++)icons.append(make('i','mini-app'));screen.append(icons,make('i','mini-dock'));}
            screen.append(make('i','mini-home'));const cell=make('div','mini-cell');cell.append(screen,make('span','mini-caption',kind==='lock' ? '锁定屏幕' : '主屏幕'));pair.append(cell);
        }
        const add=make('button','row-action wallpaper-add','添加新墙纸');add.type='button';add.dataset.focus='wall:add';add.onclick=openWallpaperPicker;card.append(pair,add);
        return [card];
    }
    function closeWallpaperPicker() {
        const sheet=$('wallpaper-picker');if(sheet.hidden)return;sheet.hidden=true;syncSettingsInert();
        if(pickerReturn?.isConnected)pickerReturn.focus({preventScroll:true});else detailBody.querySelector('[data-focus="wall:add"]')?.focus({preventScroll:true});
    }
    function openWallpaperPicker() {
        pickerReturn=document.activeElement;detail.pickerView='main';renderWallpaperPicker();$('wallpaper-picker').hidden=false;syncSettingsInert();$('wallpaper-cancel').focus({preventScroll:true});
    }
    // as on iOS, 照片 in 「添加新墙纸」 picks from the Photos app's library
    // (config.photos, both scopes' pictures); its ＋ tile imports a picture into 照片 first. Deleting is done in 照片.
    function renderWallpaperPicker() {
        const content=$('wallpaper-options'),focused=content.contains(document.activeElement),choice=document.activeElement?.dataset.choice,label=document.activeElement?.getAttribute('aria-label');content.replaceChildren();
        const library=detail.pickerView==='photos';
        $('wallpaper-picker-title').textContent=library ? '照片' : '添加新墙纸';
        if(library){
            const group=make('div','photo-pick');group.setAttribute('role','radiogroup');group.setAttribute('aria-label','照片');
            const add=make('button','photo-pick-add');add.type='button';add.dataset.choice='import';add.setAttribute('aria-label','从电脑导入照片');add.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>';
            add.onclick=()=>ask('pick',{layer:settingScope}).catch(error=>{settingsError={text:error.message,retry:()=>add.click()};renderDetail();});group.append(add);
            for(const [i,row] of (config.photos || []).entries()){
                const button=make('button','photo-pick-tile');button.type='button';button.dataset.choice=row.id;button.setAttribute('role','radio');button.setAttribute('aria-label',(row.name || '照片')+'，第 '+(i+1)+' 张');button.setAttribute('aria-checked',String(row.id===detail.draft));button.tabIndex=-1;
                if(row.url){const img=make('img');img.src=row.url;img.alt='';button.append(img);}
                button.onclick=()=>{closeWallpaperPicker();choose(row.id);};group.append(button);
            }
            group.onkeydown=event=>{const items=[...group.children],at=items.indexOf(document.activeElement),delta={ArrowRight:1,ArrowLeft:-1,ArrowDown:4,ArrowUp:-4}[event.key];if(delta!==undefined){event.preventDefault();const next=items[Math.max(0,Math.min(items.length-1,at+delta))];items.forEach(item=>item.tabIndex=item===next ? 0 : -1);next.focus({preventScroll:true});}};
            content.append(group);
            if(!(config.photos || []).length)content.append(make('p','photo-pick-empty','没有照片'));
        } else {
            const photos=make('button','photo-import','照片');photos.type='button';photos.innerHTML=svgIcon(PREF_ICONS.wallpaper)+'<span>照片</span>';photos.setAttribute('aria-label','照片');photos.dataset.choice='photos';
            photos.onclick=()=>{detail.pickerView='photos';renderWallpaperPicker();content.scrollTop=0;content.querySelector('.photo-pick-add').focus({preventScroll:true});};content.append(photos);
            // 精选: the phone's own built-in wallpaper (follows its colours), a real picture like iOS's Collections.
            const featured=make('div','gallery'),builtin=make('button','wall-tile wall-builtin');featured.setAttribute('role','radiogroup');featured.setAttribute('aria-label','精选');
            builtin.type='button';builtin.dataset.choice='none';builtin.setAttribute('role','radio');builtin.setAttribute('aria-label','默认墙纸');builtin.setAttribute('aria-checked',String(detail.draft==='none'));builtin.tabIndex=0;
            builtin.append(make('span','mini-clock',shownSettings().clockText ?? '09:41'));builtin.onclick=()=>{closeWallpaperPicker();choose('none');};featured.append(builtin);
            content.append(make('h2','picker-title','精选'),featured);
        }
        const tabbable=content.querySelector('.photo-pick [aria-checked="true"]') || content.querySelector('.photo-pick > *');if(tabbable)tabbable.tabIndex=0;
        if(focused)(choice && content.querySelector('[data-choice="'+CSS.escape(choice)+'"]') || label && content.querySelector('[aria-label="'+CSS.escape(label)+'"]') || $('wallpaper-cancel')).focus({preventScroll:true});
    }
    $('wallpaper-cancel').onclick=closeWallpaperPicker;
    $('wallpaper-picker').onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeWallpaperPicker();}else if(event.key==='Tab'){const items=[...$('wallpaper-picker').querySelectorAll('button:not(:disabled)')].filter(el=>el.tabIndex>=0),at=items.indexOf(document.activeElement);if(event.shiftKey && at===0 || !event.shiftKey && at===items.length-1){event.preventDefault();items[event.shiftKey ? items.length-1 : 0].focus();}}};
    function renderDetail() {
        if(!detail || !config)return;
        const key=detail.key,field=fieldOf(key);
        if(!field || config.status!=='ready')return;
        detail.draft=scopedDraft(key);
        // Server acknowledgements must not replace an active text/IME editor or captured slider.
        if(document.activeElement?.matches('#detail-body .field-input, #detail-body .slider')){renderDetailState();return;}
        const focus=document.activeElement?.closest?.('#detail-body [data-focus]')?.dataset.focus;
        $('detail-title').textContent=labelOf(key);
        const nodes=[];
        if(key==='wallpaper')nodes.push(...wallpaperPage());
        else if(field.type==='colour'){
            if(field.auto)nodes.push(switchGroup('自动',!!detail.draft?.auto,on=>choose(on ? {auto:true} : {fixed:hex(autoOf(key)) || field.default})));
            nodes.push(swatches(key,field));
        } else if(field.type==='choice')nodes.push(checklist(field.label,field.choices.map(row=>({value:{fixed:row.value},label:row.label})),detail.draft,choose));
        else if(field.type==='number'){
            if((field.max ?? 100)<=4){const options=[];for(let n=field.min ?? 0;n<=field.max;n++)options.push({value:{fixed:n},label:n+' 格',glyph:phoneModSignalSvg(n)});nodes.push(checklist(field.label,options,detail.draft,choose));}
            else nodes.push(slider(key,field));
        } else nodes.push(...textField(key,field));
        if(valueOf(key)?.[settingScope]!==undefined){const group=make('div','group'),reset=make('button','row-action',settingScope==='card' ? '使用所有角色卡的设置' : '恢复默认设置');reset.type='button';reset.dataset.focus='reset';reset.onclick=clearSetting;group.append(reset);nodes.push(group);}
        const error=make('div');error.id='settings-error';nodes.push(error);detailBody.replaceChildren(...nodes);renderDetailState();
        if(focus)detailBody.querySelector('[data-focus="'+CSS.escape(focus)+'"]')?.focus({preventScroll:true});
        if(!$('wallpaper-picker').hidden)renderWallpaperPicker();
    }
    function renderDetailState() {
        const error=$('settings-error');if(error)error.replaceChildren(...(settingsError ? [errorNode()] : []));
        if(detail)detailBody.setAttribute('aria-busy',String(pendingSettings.has(settingScope+':'+detail.key)));
    }
    $('detail-back').onclick=()=>showSettingsPage('root');
    // Home indicator: a 44px band; a tap or a swipe up goes home (on the home screen: puts
    // the phone away). Pressing lights it; while swiping the bar follows the finger, and going past 14px commits.
    const homeBar=$('home');let swipe=null;
    const homeAction=()=>app ? goHome() : collapse();
    const lift=px=>{if(px)homeBar.style.setProperty('--lift',px+'px');else homeBar.style.removeProperty('--lift');};
    const release=()=>{homeBar.classList.remove('pressed','dragging');lift(0);};
    homeBar.addEventListener('pointerdown',event=>{if(event.button!==0)return;swipe={y:event.clientY,done:false,id:event.pointerId};homeBar.setPointerCapture?.(event.pointerId);homeBar.classList.add('pressed');endHint();});
    homeBar.addEventListener('pointermove',event=>{
        if(!swipe || swipe.id!==event.pointerId || swipe.done)return;
        const up=(swipe.y-event.clientY)/(parseFloat(document.documentElement.style.zoom) || 1);
        if(up>2){homeBar.classList.add('dragging');lift(-Math.min(18,up*.7));}
        if(up>14){swipe.done=true;release();homeAction();}
    });
    homeBar.addEventListener('pointerup',()=>{if(swipe && !swipe.done)release();});
    homeBar.addEventListener('pointercancel',()=>{swipe=null;release();});
    homeBar.onclick=event=>{const swiped=swipe?.done;swipe=null;release();event.stopPropagation();if(!swiped)homeAction();};
    // Once per phone (this view's life): the first time it is opened, the bar lifts twice so the reader sees it can move.
    let hinted=false;
    function endHint() {homeBar.classList.remove('hint');}
    homeBar.addEventListener('animationend',event=>{if(event.target===homeBar)homeBar.classList.remove('hint');});
    homeBar.addEventListener('pointerenter',()=>endHint());homeBar.addEventListener('focus',()=>endHint());
    function maybeHint() {
        if(hinted || presentation.state!=='open' || presentation.suspended)return;
        hinted=true;homeBar.classList.add('hint');
    }
    // ---- thread list ---------------------------------------------------------------------------------------------
    function preview(thread) {
        const last=thread.messages?.at(-1);if(!last)return '';
        const body=last.form==='voice' ? '[\u8bed\u97f3]' : String(last.text || '').replace(/\s+/g,' ');
        const who=thread.kind==='group' && last.side==='in' ? senderName(last) : '';
        return who ? who+'\uff1a'+body : body;
    }
    function makeThreadRow() {
        const item=document.createElement('li'),button=document.createElement('button'),dot=document.createElement('i'),pic=document.createElement('span'),main=document.createElement('span'),top=document.createElement('span'),name=document.createElement('strong'),count=document.createElement('span'),chevron=document.createElement('span'),line=document.createElement('span');
        button.type='button';button.className='thread-row';dot.className='unread';dot.setAttribute('aria-hidden','true');pic.className='pic';pic.setAttribute('aria-hidden','true');
        main.className='main';top.className='line-top';count.className='count';chevron.className='chev';chevron.setAttribute('aria-hidden','true');chevron.innerHTML='<svg viewBox="0 0 8 13"><path d="M1.5 1.5 6.5 6.5l-5 5"/></svg>';line.className='preview';
        const typing=document.createElement('span');typing.className='dots';typing.setAttribute('aria-hidden','true');typing.append(document.createElement('i'),document.createElement('i'),document.createElement('i'));
        top.append(name,count,chevron);main.append(top,line,typing);button.append(dot,pic,main);item.append(button);
        button.onclick=()=>go('thread',button.dataset.threadId);
        return item;
    }
    function renderList() {
        const threads=threadList(),box=$('threads'),existing=new Map([...box.children].map(item=>[item.firstChild.dataset.threadId,item]));
        // Earlier conversations still being read are not 「还没有对话」.
        $('threads-empty').hidden=threads.length>0 || source?.historyStatus==='loading';
        for(const [id,item] of existing)if(!threads.some(thread=>thread.id===id))item.remove();
        threads.forEach((thread,index)=>{
            const item=existing.get(thread.id) || makeThreadRow(),button=item.firstChild,[dot,pic,main]=button.children,[top,line,typing]=main.children,[name,count]=top.children;
            button.dataset.threadId=thread.id;button.dataset.kind=thread.kind;
            const group=thread.kind==='group',title=threadTitle(thread),text=preview(thread),unread=unreadOf(thread);
            if(name.textContent!==title)name.textContent=title;
            const members=group ? '('+thread.participants.length+')' : '';
            if(count.textContent!==members)count.textContent=members;
            if(line.textContent!==text)line.textContent=text;
            // Someone typing in that conversation: the list shows the three dots instead of the preview, as on iOS.
            const isTyping=Boolean(thread.typing && thread.typing.side==='in' && live());
            line.hidden=isTyping;typing.hidden=!isTyping;
            dot.classList.toggle('on',Boolean(unread));
            if(group)stack(pic,thread,44);
            else {const key='1|'+(others(thread)[0]?.id || thread.id)+'|'+faceKey(others(thread)[0] || {id:thread.id,name:title});if(pic.forkKey!==key){pic.forkKey=key;pic.dataset.count='1';placeFaces(pic,[face(others(thread)[0] || {id:thread.id,name:title},44)]);}}
            button.setAttribute('aria-label',title+(members ? ' '+members : '')+(unread ? '\uff0c'+unread+' \u6761\u672a\u8bfb' : '')+(text ? '\uff0c'+text : ''));
            if(box.children[index]!==item)box.insertBefore(item,box.children[index] || null);
        });
    }
    // no 「正在输入…」 under the title. While an incoming line is still being revealed the thread
    // shows an iMessage typing bubble (three dots) from its sender below the latest message; the line itself arrives whole.
    function makeTypingRow() {
        const row=document.createElement('article'),image=document.createElement('img'),bubble=document.createElement('div'),dots=document.createElement('span');
        row.className='typing';row.dataset.side='in';image.alt='';image.width=image.height=28;image.decoding='async';
        bubble.className='bubble typing-bubble';bubble.setAttribute('role','img');bubble.setAttribute('aria-label','\u6b63\u5728\u8f93\u5165');
        dots.className='dots';dots.setAttribute('aria-hidden','true');dots.append(document.createElement('i'),document.createElement('i'),document.createElement('i'));
        bubble.append(dots);row.append(image,bubble);
        row.addEventListener('animationend',event=>{if(event.target===row)row.classList.remove('enter');});
        return row;
    }
    const typingRow=makeTypingRow();
    // A group member without a photo shows their initial on the grey contact circle beside their last bubble.
    function initial(row,name) {const value=Array.from(name.trim())[0] || '';if(value)row.dataset.initial=value;else delete row.dataset.initial;}
    let threadTask=null,typedId=null;
    // Same sender run: a group starts a new run whenever the speaker changes (name above the first bubble, face on the last).
    const sameRun=(a,b,group)=>Boolean(a && b && a.side===b.side && a.turn===b.turn && (!group || a.side!=='in' || senderKey(a)===senderKey(b)));
    function renderThread(lines,current,typingIn,composing) {
        const top=messages.scrollTop,atBottom=messages.scrollHeight-messages.clientHeight-top<24;
        const anchor=atBottom?null:[...messages.children].find(row=>row.getBoundingClientRect().bottom>messages.getBoundingClientRect().top),anchorTop=anchor?.getBoundingClientRect().top;
        const typing=typingIn ? current : null,group=isGroup();
        const visible=composing || typing ? lines.filter(row=>row.id!==current.id) : lines;
        const existing=new Map([...messages.children].filter(row=>row!==typingRow).map(row=>[row.dataset.messageId,row])),keep=new Set(visible.map(message=>message.id));
        for(const [id,row] of existing)if(!keep.has(id))row.remove();
        let index=0,created=0;
        for(const [i,message] of visible.entries()) {
            let row=existing.get(message.id);
            if(!row){
                // Bound initial history construction even when the iframe shares the stage thread.
                if(created===8){if(threadTask===null)threadTask=setTimeout(()=>{threadTask=null;render();},0);break;}
                created++;row=makeRow(message);
                // Only a fresh, live line animates in; history, skip and restores appear at once.
                if(hydrated && live() && message.id===current?.id && (message.id!==lastCurrent || message.id===typedId))row.classList.add(message.side==='out'?'sent':'enter');
                else if(hydrated && live() && message.side==='out' && message.id===current?.id)row.classList.add('sent');
            }
            const [image,column,note]=row.children,[sender,bubble]=column.children,[text,play,duration,transcript]=bubble.children,previous=visible[i-1],next=visible[i+1];
            row.dataset.side=message.side;row.dataset.voice=message.voice || '';
            const after=next || typing;
            row.classList.toggle('start',!sameRun(previous,message,group));
            row.classList.toggle('end',!sameRun(message,after,group));
            row.classList.toggle('turn-start',Boolean(previous && previous.turn!==message.turn));
            setImage(image,message.side==='in' && row.classList.contains('end') ? senderAvatar(message) : null);
            initial(row,group && message.side==='in' && row.classList.contains('end') && image.hidden ? senderName(message) : '');
            const who=group && message.side==='in' && row.classList.contains('start') ? senderName(message) : '';
            if(sender.textContent!==who)sender.textContent=who;
            sender.hidden=!who;
            if(text.textContent!==message.text)text.textContent=message.text;
            bubble.classList.toggle('sticker',STICKER.test(message.text.trim()) && message.revealed!==false);
            const voice=message.form==='voice';
            row.dataset.form=voice?'voice':'text';
            // Mod rows always have a form; generic source-widget rows retain their optional replay handle.
            play.hidden=message.form ? !voice : !message.voice;play.disabled=!message.voice;
            duration.hidden=transcript.hidden=!voice;
            if(voice){const label='约 '+voiceSeconds(message.text)+' 秒';if(duration.textContent!==label)duration.textContent=label;}
            transcript.setAttribute('aria-expanded',String(Boolean(message.transcript)));
            text.classList.toggle('transcript',voice);text.classList.toggle('is-expanded',Boolean(message.transcript));
            text.setAttribute('aria-hidden',String(voice && !message.transcript));
            note.hidden=!message.truncated;
            // Preserve focused controls, text selection and scroll while an unrelated message reveals.
            if(messages.children[index]!==row)messages.insertBefore(row,messages.children[index] || null);
            index++;
        }
        if(typing && index===visible.length) {
            const previous=visible.at(-1),fresh=!typingRow.isConnected;
            typingRow.classList.toggle('start',!sameRun(previous,typing,group));
            typingRow.classList.toggle('turn-start',Boolean(previous && previous.turn!==typing.turn));
            typingRow.classList.add('end');
            setImage(typingRow.firstChild,senderAvatar(typing));
            initial(typingRow,group && typingRow.firstChild.hidden ? senderName(typing) : '');
            if(fresh && hydrated && live())typingRow.classList.add('enter');
            if(messages.lastChild!==typingRow)messages.append(typingRow);
        } else typingRow.remove();
        typedId=typing && typingRow.isConnected ? typing.id : null;
        messages.scrollTop=atBottom?messages.scrollHeight:top+(anchor?.isConnected?anchor.getBoundingClientRect().top-anchorTop:0);
        requestEarlier();
    }
    // Scrolling up to the start of the conversation asks the host for its earlier messages (80 more each time, then earlier
    // turns): the whole conversation, as a real messaging app, never a pointer to the backlog.
    let earlierKey='';
    function requestEarlier() {
        if(!hydrated || !source?.hasEarlier || messages.scrollTop>60 || presentation.state!=='open' || app!=='messages' || route!=='thread')return;
        const key=(source.threadId || '')+'|'+source.messages.length+'|'+(source.loadedTurns || 0);
        if(key!==earlierKey){earlierKey=key;send('phone.earlier');}
    }
    messages.addEventListener('scroll',requestEarlier,{passive:true});
    // ---- notification banner ---------------------------------------------------------------------------------------
    // a real phone's notification banner — app row (icon · 信息 · 现在), the sender in bold, a
    // one-line preview (a voice message reads 「[语音] 4″」) and the sender's small avatar on the right. In a group the title
    // is the group and the preview starts with the sender, as on iOS.
    function renderIsland(last,name,avatar,typingIn,current) {
        const shown=current?.side==='in' ? current : null,attention=presentation.attention || {count:0,changed:false},group=isGroup();
        island.hidden=!shown;
        const avatarUrl=shown ? senderAvatar(shown) : null;
        setImage($('island-avatar'),avatarUrl);island.classList.toggle('has-avatar',Boolean(avatarUrl));
        const title=!shown ? '' : group ? shownThread().name : contactName(shown.contact) || shown.name || '\u6d88\u606f';
        if($('island-name').textContent!==title)$('island-name').textContent=title;
        // On someone else's phone the banner says whose phone it is where the app name usually stands.
        const phoneRow=owner()!==PLAYER ? phoneList().find(row=>row.id===owner()) : null,appName=phoneRow ? ownerLabel(phoneRow) : '\u4fe1\u606f',appNode=island.querySelector('.island-app');
        if(appNode.textContent!==appName)appNode.textContent=appName;
        const body=shown?.form==='voice' ? '[语音] '+voiceSeconds(shown.text)+'″' : !shown ? '' : shown.text.replace(/\s+/g,' ');
        const preview=group && body ? senderName(shown)+'\uff1a'+body : body;
        const box=$('island-preview');
        if(box.textContent!==preview)box.textContent=preview;
        $('island-typing').hidden=!(typingIn && shown && !preview);
        const count=Number(attention.count) || 0;
        island.setAttribute('aria-label','\u6253\u5f00\u624b\u673a'+(name?'\uff1a'+name:'')+(count?'\uff0c'+(count>99?'99+':count)+' \u6761\u5f85\u67e5\u770b':attention.changed?'\uff0c\u6709\u66f4\u65b0':''));
    }
    const openFromIsland=()=>send('action',{action:'open'});
    island.onclick=openFromIsland;
    island.onkeydown=event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();openFromIsland();}};
    const collapse=()=>send('action',{action:'collapse'});
    $('toggle').onclick=()=>{if(navigable())go('list');else send('action',{action:presentation.state==='open'?'collapse':'open'});};
    // Clicking the live conversation reads on, as the dialogue box does; the list, other threads, the home screen and
    // Settings never do.
    const control='button,a,input,textarea,[role="button"],#list-view,#group-info,#home-screen,#settings-app,#phone-app,#photos-app,#handover';
    document.addEventListener('click',event=>{
        if(followingLive() && !event.target.closest(control))send('stage.advance');
    });
    // Esc steps back one level at a time: conversation → list → home screen → phone away; account list → Settings → home.
    function back() {
        if(app==='settings'){if(!confirmBox.hidden)confirmClose(false);else if(!$('wallpaper-picker').hidden)closeWallpaperPicker();else if(settingsPage!=='root')showSettingsPage(settingsPage==='scope' ? 'accounts' : 'root');else goHome();}
        else if(app==='messages'){if(groupInfo)closeGroupInfo();else if(route==='thread' && navigable())go('list');else if(navigable())goHome();else collapse();}
        else if(app==='phone'){if(!dialer.back())goHome();}
        else if(app==='photos'){if(!photos.back())goHome();}
        else collapse();
    }
    window.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();back();}
        else if((event.key==='Enter' || event.key===' ') && followingLive() && !event.target.closest(control)){event.preventDefault();send('stage.advance');}
    });
    // the open phone owns scroll input. The wheel / touchpad / touch
    // scroll moves the view under it (the list, the conversation, a Settings page) and stops at either end; it never drives
    // the story (no 履历 at the top, no page turn at the bottom) and never chains out of the phone. A wheel that landed on the
    // dimmed stage around the phone arrives as `wheel` and scrolls the view on screen the same way. Clicks, Enter and Space
    // still advance the story as before.
    function scroller() {
        if(app==='messages')return route==='list' && navigable() ? $('list-view').querySelector('.scroll') : groupInfo ? $('group-info').querySelector('.scroll') : messages;
        if(app==='settings')return $(settingsPage==='accounts' ? 'settings-accounts' : settingsPage==='scope' ? 'settings-scope' : settingsPage==='detail' ? 'settings-detail' : 'settings-root').querySelector('.scroll');
        if(app==='phone')return dialer.scroller();
        if(app==='photos')return photos.scroller();
        return null;
    }
    window.addEventListener('wheel',event=>{if(!event.target.closest?.('.scroll,#messages'))event.preventDefault();},{passive:false});
    function scrollView(deltaY,deltaMode) {
        const box=scroller();if(!box)return;
        box.scrollTop+=deltaY*(deltaMode===1 ? 40 : deltaMode===2 ? box.clientHeight : 1);
    }
    // ---- phone call (prototype) ------------------------------------------------
    // The host owns the microphone, speech recognition, the model and her voice; this page draws the call screen and
    // the 电话 app (dialer.js), where the calls and their words are kept (one context window per contact). Messages never shows
    // calls.
    let call=null;
    // One test for every way into a call: speech recognition answering and a voice for that contact (not yet known = the
    // host checks it when the call starts).
    const callable=id=>Boolean(id && call?.available && call.voices?.[id]!==false);
    const startCall=(contactId,video=false)=>send('phone.call',{action:'start',contactId,...(video ? {video:true} : {})});
    // The details' 信息 opens the player's own conversation with that contact.
    const directWith=contactId=>owner()===PLAYER ? threadList()?.find(thread=>thread.kind!=='group' && others(thread).length===1 && others(thread)[0].id===contactId) || null : null;
    const dialer=phoneModDialer({app:$('phone-app'),face,photo:personAvatar,nameOf:personName,onCall:person=>startCall(person.id),onVideo:person=>startCall(person.id,true),onRetry:()=>send('phone.call',{action:'threads',voices:true}),
        threadOf:directWith,onMessage:thread=>{stopMotion();app='messages';go('thread',thread.id);}});
    // 照片 (photos.js): the phone's one picture library; 用作墙纸 and imports write to the scope Settings edits.
    const photos=phoneModPhotos({app:$('photos-app'),ask,scope:()=>settingScope,reduced});
    // The title opens the existing Phone card (a group's title, its details); its root back returns here without moving the
    // thread's scroll position.
    function openCard(id,label,returnTo) {
        openApp('phone',false);
        dialer.openContact(id,{label,onBack:()=>{stopMotion();app='messages';render();returnTo()?.focus({preventScroll:true});}});
    }
    $('thread-contact').onclick=()=>{
        if($('thread-contact').disabled)return;
        if(isGroup()){openGroupInfo();return;}
        const person=callPeer();
        if(person)openCard(person.id,'返回对话',()=>$('thread-contact'));
    };
    // ---- group details (iOS 26) --------------
    // The group's title opens its details, pushed over the conversation (which only slides under, so its scroll place is
    // kept): the cluster (CLUSTER, 73 pt) and the group's name, then the members as iOS 26 lays them out - round 82 pt photos
    // three to a row with the name under each. A member the player has a card for opens that card (the one the 1:1 title
    // opens); its back returns here, and ‹ / Esc here returns to the conversation. Only what the story has: no add, leave,
    // alerts, backgrounds, tabs or call keys.
    function openGroupInfo() {groupInfo=shownThread()?.id || null;$('group-info').querySelector('.scroll').scrollTop=0;render();$('group-info-back').focus({preventScroll:true});}
    function closeGroupInfo() {groupInfo=null;render();$('thread-contact').focus({preventScroll:true});}
    $('group-info-back').onclick=closeGroupInfo;
    function renderGroupInfo(thread) {
        const open=Boolean(groupInfo && thread),pos=open ? 'on' : 'off';
        $('messages-app').dataset.page=open ? 'group' : 'thread';
        if($('group-info').dataset.pos!==pos)$('group-info').dataset.pos=pos;
        if(!open)return;
        stack($('group-info-face'),thread,Math.round(73*point));
        if($('group-info-name').textContent!==thread.name)$('group-info-name').textContent=thread.name;
        const people=others(thread),box=$('group-members'),size=Math.round(82*point);
        const key=JSON.stringify([people.map(person=>[person.id,personName(person),faceKey(person),Boolean(cardOf(person))]),size]);
        if(box.forkKey===key)return;
        box.forkKey=key;
        const focused=box.contains(document.activeElement) ? document.activeElement.dataset.memberId : null;
        box.replaceChildren(...people.map(person=>{
            const card=cardOf(person),name=personName(person),item=document.createElement(card ? 'button' : 'div'),holder=document.createElement('span'),label=document.createElement('span');
            item.className='member';item.dataset.memberId=person.id;
            holder.className='owner-face';holder.append(face(person,size));
            label.className='member-name';label.textContent=name;
            item.append(holder,label);
            if(card){item.type='button';item.setAttribute('aria-label','查看'+name+'的联系人卡片');
                item.onclick=()=>openCard(person.id,'返回'+thread.name,()=>box.querySelector(`[data-member-id="${CSS.escape(person.id)}"]`));}
            return item;
        }));
        if(focused)box.querySelector(`[data-member-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    }
    const callPeer=()=>{const thread=shownThread();return thread && thread.kind!=='group' ? others(thread)[0] || null : null;};
    const CALL_PARTIAL_CHARS=48;
    // iOS's call screen: 呼叫中… while her phone rings, the
    // call clock once she picks up (m:ss, h:mm:ss past an hour), 「通话结束」 the moment 结束 is pressed - the screen greys
    // and its buttons stop answering - until the stage lets the call go, when the screen slides away to wherever the call was
    // made (电话 or the conversation).
    let callOpen=false,callLeaving=null,ending=false,callReturn=null;
    const callClock=seconds=>(seconds>=3600 ? Math.floor(seconds/3600)+':'+String(Math.floor(seconds/60)%60).padStart(2,'0') : Math.floor(seconds/60))+':'+String(seconds%60).padStart(2,'0');
    // The callee's face: the phone's contact row (the 电话 app's list), else a conversation's participant.
    const callee=id=>source?.contacts?.find(row=>row.id===id) || personOf(id);
    function callMotion(box,entering) {
        if(typeof box.animate!=='function' || presentation.state!=='open')return null;
        const calm=reduced(),frames=calm ? [{opacity:0},{opacity:1}] : [{opacity:0,transform:'translateY(28px) scale(.985)'},{opacity:1,transform:'none'}];
        return box.animate(entering ? frames : [...frames].reverse(),{duration:calm ? 160 : entering ? 340 : 380,easing:entering ? 'cubic-bezier(.2,.85,.25,1)' : 'cubic-bezier(.4,0,.6,1)',fill:entering ? 'none' : 'forwards'});
    }
    function leaveCall(box) {
        callOpen=false;ending=false;
        const done=()=>{box.hidden=true;callLeaving?.cancel();callLeaving=null;
            if(box.contains(document.activeElement) || document.activeElement===document.body)(callReturn?.isConnected && !callReturn.closest('[hidden]') ? callReturn : app==='phone' ? dialer.first() : null)?.focus({preventScroll:true});callReturn=null;};
        callLeaving=callMotion(box,false);
        if(callLeaving)callLeaving.finished.then(()=>{if(!callOpen)done();},()=>{});else done();
    }
    function renderCall() {
        const box=$('call'),status=call?.status || 'idle';
        // The status bar and home indicator are the app's again as the screen starts to slide away.
        if(status==='idle'){body.dataset.call='';body.dataset.callVideo='';delete body.dataset.callSheet;if(callOpen){videoLayout(null);leaveCall(box);}return;}
        if(!callOpen){
            callOpen=true;callLeaving?.cancel();callLeaving=null;box.hidden=false;
            callReturn=document.activeElement!==document.body ? document.activeElement : null;
            // The video's boxes are measured where the screen comes to rest, not mid-slide.
            const entering=callMotion(box,true);
            if(entering){callSettling=true;entering.finished.catch(()=>{}).then(()=>{callSettling=false;if(call?.video)videoLayout('call');});}
            box.focus({preventScroll:true});
        }
        const look=ending || status==='ended' ? 'ended' : status==='connecting' ? 'ringing' : status==='error' ? 'error' : 'connected';
        box.dataset.look=look;body.dataset.call=status;
        // Once she picks up, her photo and the clock move to the top-left corner (iOS 26), and stay there as the call ends.
        box.dataset.connected=String(Boolean(call.connected));
        const person=callee(call.contactId) || {id:call.contactId,name:call.name};
        const name=contactName(call.contactId) || call.name || person.name || '';
        if($('call-name').textContent!==name)$('call-name').textContent=name;
        // A face still being prepared is a quiet circle (no initial that turns into a face a moment later), as in the lists.
        const url=personAvatar(person),initial=url || person.avatarPending ? '' : Array.from(name)[0] || '';
        // The screen stands on the phone's wallpaper (style.css .call-wall), as her card does.
        setImage($('call-avatar'),url);$('call-initial').hidden=Boolean(url);
        if($('call-initial').textContent!==initial)$('call-initial').textContent=initial;
        const seconds=call.connected ? Number(call.elapsed) || 0 : 0;
        const text=look==='ended' ? '\u901a\u8bdd\u7ed3\u675f' : look==='error' ? call.error || '\u901a\u8bdd\u5931\u8d25' : look==='ringing' ? '\u547c\u53eb\u4e2d\u2026' : callClock(seconds);
        if($('call-status').textContent!==text)$('call-status').textContent=text;
        box.dataset.speaking=status==='speaking' && look==='connected' ? 'true' : 'false';
        // The player's words while still talking (recognized so far, revised as they go) follow the call's lines: only
        // the latest words, and kept out of the screen reader's announcements until they become a line.
        const lines=(call.lines || []).slice(-3),partial=Array.from(call.partial || ''),holder=$('call-lines'),key=JSON.stringify([lines,call.partial || '']);
        // Her line grows with her voice while she says it (line.revealing); the screen reader hears the lines once it is whole.
        if(holder.forkKey!==key){holder.forkKey=key;holder.setAttribute('aria-busy',String(lines.some(line=>line.revealing)));holder.replaceChildren(...lines.map(line=>{
            const row=document.createElement('p');row.className='call-line';row.dataset.role=line.role;
            // One line each, as the story reads it: her voice's own language is never shown.
            const main=document.createElement('span');main.textContent=line.text;row.append(main);
            return row;}));
            if(partial.length){const row=document.createElement('p');row.className='call-line';row.dataset.role='player';row.dataset.partial='true';row.setAttribute('aria-hidden','true');
                const main=document.createElement('span');main.textContent=(partial.length>CALL_PARTIAL_CHARS ? '\u2026' : '')+partial.slice(-CALL_PARTIAL_CHARS).join('');row.append(main);holder.append(row);}}
        // 静音 is iOS's: the struck-through microphone on glass while she hears the player, on white while she does not. Once
        // the call is over neither button answers again; 扬声器, FaceTime, 更多 and 键盘 never answer (aria-disabled, no handler).
        $('call-mute').setAttribute('aria-pressed',String(Boolean(call.muted)));
        $('call-mute').disabled=look==='ended' || look==='error';
        $('call-end').disabled=look==='ended';
        // FaceTime works on a connected call with someone the stage can show, when this phone declares its call view (mod.json).
        $('call-video').setAttribute('aria-disabled',String(!(settings.callVideo && look==='connected' && call.videos?.[call.contactId]!==false)));
        const video=Boolean(call.video);
        // The call screen keeps its look as it slides away after a hang-up; the page behind follows every call (idle clears it),
        // so a second FaceTime call hides the app it was dialled from again.
        body.dataset.callVideo=video ? 'true' : '';
        if(box.dataset.video!==String(video)){box.dataset.video=String(video);$('ft').hidden=!video;if(video && box.contains(document.activeElement))box.focus({preventScroll:true});}
        if(video)renderFaceTime(look,person,name,url,initial);
        videoLayout(video && look!=='error' ? 'call' : null);
    }
    // ---- FaceTime --------------------------------------------------------------------
    // iOS 26's on-call screen over her video: the stage draws her (and, camera on, the player) under this page in the boxes
    // `videoLayout` reports; everything here is glass and glyphs, never a status word. Our two additions: the call's lines as
    // chat bubbles (hers left, the player's right; each of hers only once its voice is heard) and 「无法打开摄像头」 where the
    // self view would be when the player has no figure.
    function renderFaceTime(look,person,name,url,initial) {
        if($('ft-who').textContent!==name)$('ft-who').textContent=name;
        $('ft-name').setAttribute('aria-label',name+'，联系人卡片');
        setImage($('ft-avatar'),url);$('ft-initial').hidden=Boolean(url);
        if($('ft-initial').textContent!==initial)$('ft-initial').textContent=initial;
        const camera=Boolean(call.camera),ended=look==='ended';
        $('ft-self').hidden=!camera;$('ft-self-error').hidden=!camera || call.selfFigure!==false;
        $('ft-camera').setAttribute('aria-pressed',String(camera));$('ft-mic').setAttribute('aria-pressed',String(!call.muted));
        for(const id of ['ft-camera','ft-mic','ft-name'])$(id).disabled=ended;
        $('ft-shutter').disabled=ended || look==='ringing';
        $('ft-end').disabled=ended;
        const lines=(call.lines || []).slice(-6),partial=Array.from(call.partial || ''),holder=$('ft-lines'),key=JSON.stringify([lines,call.partial || '']);
        if(holder.forkKey===key)return;
        holder.forkKey=key;holder.setAttribute('aria-busy',String(lines.some(line=>line.revealing)));
        holder.replaceChildren(...lines.map(line=>{const row=document.createElement('p');row.className='ft-line';row.dataset.role=line.role;row.textContent=line.text;return row;}));
        if(partial.length){const row=document.createElement('p');row.className='ft-line';row.dataset.role='player';row.dataset.partial='true';row.setAttribute('aria-hidden','true');
            row.textContent=(partial.length>CALL_PARTIAL_CHARS ? '\u2026' : '')+partial.slice(-CALL_PARTIAL_CHARS).join('');holder.append(row);}
    }
    // Where the stage draws the video: the call screen's box (her) and the self view's (the player), as fractions of this page,
    // with the framing the phone declares. Sent when it changes; null when the call screen goes (the stage fades in 120 ms).
    let videoSent='null',callSettling=false;
    function videoLayout(mode) {
        const declared=settings.callVideo,box=$('call');
        let value=null;
        if(mode && declared && presentation.state==='open' && !box.hidden && !callSettling){
            const page=document.documentElement.getBoundingClientRect(),frac=(element,radius)=>{const r=element.getBoundingClientRect(),k=element.offsetWidth ? r.width/element.offsetWidth : 1;
                return {rect:{x:(r.left-page.left)/page.width,y:(r.top-page.top)/page.height,width:r.width/page.width,height:r.height/page.height},radius:radius*k/page.width};};
            const own=frac(box,parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0);
            const views=own.rect.width>0 ? [{role:'remote',...own,head:declared.remote.head}] : [];
            if(call?.camera && call.selfFigure!==false && !$('ft-self').hidden)views.push({role:'self',...frac($('ft-self'),parseFloat(getComputedStyle($('ft-self')).borderTopLeftRadius) || 0),head:declared.self.head});
            value=views.length ? {views,backdrop:declared.backdrop,...(call?.video ? {glass:glassShapes(page)} : {})} : null;
        }
        const sent=JSON.stringify(value);
        if(sent===videoSent)return;
        videoSent=sent;send('phone.video',{video:value});
    }
    // iOS 26 Liquid Glass blurs the video behind it; this page cannot see the stage's picture, so it tells the stage where its
    // glass is - every FaceTime element whose fill is translucent (the pill, the bubbles, a glass key, the red end key), with
    // its opacity (a bubble fading out at the top of the history at its place in the fade) - and the stage blurs her video
    // there, under the tint and rim drawn here. CSS stays the one authority: a key turning white stops being glass.
    function glassShapes(page) {
        const ft=$('ft'),style=getComputedStyle(ft),pt=page.width/393,lines=$('ft-lines').getBoundingClientRect(),fade=56*pt;
        const opacity=element=>{let value=1;for(let node=element;node && node!==ft.parentElement;node=node.parentElement)value*=Number(getComputedStyle(node).opacity);return value;};
        const rects=[...ft.querySelectorAll('.ft-pill, .ft-line, #ft-self-error, .ft-keys button')].flatMap(element=>{
            if(element.closest('[hidden]'))return [];
            const css=getComputedStyle(element),fill=css.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
            const fillAlpha=fill.length===4 ? fill[3] : fill.length===3 ? 1 : 0;
            if(!(fillAlpha>0 && fillAlpha<1))return [];
            let r=element.getBoundingClientRect(),alpha=opacity(element);
            if(element.classList.contains('ft-line')){
                const top=Math.max(r.top,lines.top);if(r.bottom<=top)return [];
                alpha*=Math.min(1,Math.max(0,((top+r.bottom)/2-lines.top)/fade));
                r={left:r.left,top,width:r.width,height:r.bottom-top};
            }
            if(!r.width || !r.height || alpha<=0.01)return [];
            const radius=Math.min(parseFloat(css.borderTopLeftRadius) || 0,r.width/2,r.height/2);
            const round=n=>Math.round(n*1e4)/1e4;
            return [{x:round((r.left-page.left)/page.width),y:round((r.top-page.top)/page.height),width:round(r.width/page.width),height:round(r.height/page.height),radius:round(radius/page.width),alpha:round(alpha)}];
        });
        return {blur:(Number(style.getPropertyValue('--glass-blur')) || 0)*pt/page.width,saturate:Number(style.getPropertyValue('--glass-saturate')) || 1,rects};
    }
    new ResizeObserver(()=>{if(call?.video)videoLayout('call');}).observe($('call'));
    // A glass element that has finished fading (hang-up) or moving is measured again.
    $('ft').addEventListener('transitionend',()=>{if(call?.video)videoLayout('call');});
    $('call-video').onclick=()=>{if($('call-video').getAttribute('aria-disabled')!=='true')send('phone.call',{action:'video'});};
    $('ft-camera').onclick=()=>send('phone.call',{action:'camera',on:!call?.camera});
    $('ft-mic').onclick=()=>send('phone.call',{action:'mute',muted:!call?.muted});
    $('ft-end').onclick=()=>$('call-end').onclick();
    // The white button keeps the frame she is in (her video) in this phone's 照片; nothing is written on screen.
    $('ft-shutter').onclick=()=>send('phone.call',{action:'snapshot'});
    // The pill opens her contact card over the call; the call goes on, and closing the card returns to it.
    $('ft-name').onclick=()=>{
        if(!call?.contactId)return;
        body.dataset.callSheet='contact';openApp('phone',false);
        dialer.openContact(call.contactId,{label:'返回通话',onBack:()=>{delete body.dataset.callSheet;stopMotion();render();$('ft-name').focus({preventScroll:true});}});
    };
    $('call-button').onclick=()=>{const peer=callPeer();if(peer)startCall(peer.id);};
    // The press answers at once (the stage confirms a moment later).
    $('call-end').onclick=()=>{if(call?.status && call.status!=='error'){ending=true;renderCall();}send('phone.call',{action:'end'});};
    $('call-mute').onclick=()=>send('phone.call',{action:'mute',muted:!call?.muted});
    reducedQuery.addEventListener?.('change',()=>{appearance();render();});
    // The incoming tone, once per playback event: a live line's arrival, or (playback.replay = that message's id) a settled
    // history page replaying its line. A replay waits for the source that holds its message.
    function ring(){
        if(!source || !playback.eventToken || playback.eventToken===lastEvent)return;
        const row=source.messages.find(row=>row.id===(playback.replay || source.current?.id));
        if(playback.replay && !row)return;
        lastEvent=playback.eventToken;
        if(settings.sound!==false && row?.side==='in' && (playback.mode==='live' || playback.replay) && playback.fresh && !playback.skipping && !playback.paused && !presentation.suspended)send('audio.play',{asset:'message',eventToken:playback.eventToken});
    }
    window.addEventListener('message',event=>{
        const value=event.data;
        if(event.source!==parent || !value || value.channel!=='dsh-widget' || value.version!==2 || typeof value.token!=='string')return;
        if(value.type==='init'){
            if(token)return;token=value.token;settings=value.settings || {};settingAssets=value.settingAssets || {};theme=value.theme || {};playback=value.playback || {};presentation=value.presentation || presentation;
            appearance();render();send('ready');return;
        }
        if(!token || value.token!==token)return;
        if(value.type==='presentation'){presentation=value.presentation || presentation;render();if(call)renderCall();}
        else if(value.type==='update')render();
        else if(value.type==='settings'){settings=value.settings || {};settingAssets=value.settingAssets || {};appearance();if(source)render();if(call)renderCall();}
        else if(value.type==='phone.config'){config=value.config || null;configSerial++;photos.update(config);if(config?.status==='idle' && (app==='settings' || app==='photos'))ask('load').catch(()=>{});renderPrefs();if(detail)renderDetail();appearance();}
        else if(value.type==='phone.settings.result'){const wait=waiting.get(value.requestId);if(wait){waiting.delete(value.requestId);if(value.ok)wait.resolve();else wait.reject(new Error(value.error || '没能保存'));}}
        else if(value.type==='source'){
            const changed=source?.threadKey!==value.source?.threadKey,before=source?.current?.id,beforePhone=shownPhoneId;source=value.source;shownPhoneId=owner();
            if(changed){messages.replaceChildren();hydrated=false;}
            // Another phone: the reader's own switch (in Settings) unlocks to its home screen, with Messages on its list; the
            // story's (a message reaching that phone) opens that conversation.
            if(beforePhone!==null && beforePhone!==shownPhoneId){
                const manual=pendingPhone===shownPhoneId;
                viewing=null;groupInfo=null;route=manual && navigable() ? 'list' : 'thread';stopMotion();app=manual ? null : 'messages';settingsPage='root';closeDetail();dialer.reset();photos.reset();confirmBox.hidden=true;
                handOver(phoneList().find(row=>row.id===shownPhoneId),manual);
                if(manual)requestAnimationFrame(()=>home.querySelector('[data-app="settings"]')?.focus({preventScroll:true}));
            }
            if(pendingPhone===shownPhoneId)pendingPhone=null;
            const fresh=source?.current?.id && source.current.id!==before;
            // A new story line takes the reader back to its conversation (the phone line is only readable there).
            if(fresh && live())groupInfo=null;
            if(fresh && live() && app!=='messages'){stopMotion();app='messages';settingsPage='root';closeDetail();dialer.reset();photos.reset();confirmBox.hidden=true;}
            if(fresh && live() && navigable() && (route!=='thread' || viewing && viewing!==source.liveThreadId)){route='thread';viewing=null;send('phone.view',{threadId:null});}
            // A phone with conversations but none in the story yet opens on the list.
            if(navigable() && !source.threadId && route==='thread' && !viewing)route='list';
            ring();
            render();
            // The call screen's face and name come from the same source (a face prepared after the call began arrives in place).
            if(call)renderCall();
            if(changed)messages.scrollTop=messages.scrollHeight;
        } else if(value.type==='playback'){playback=value.playback || {};if(playback.replay)ring();render();}
        else if(value.type==='theme'){theme=value.theme || {};appearance(value.transitionMs || 0);}
        else if(value.type==='wheel'){if(presentation.state==='open')scrollView(Number(value.deltaY) || 0,value.deltaMode);}
        else if(value.type==='phone.call.state'){const key=next=>JSON.stringify([next?.threads || {},next?.available === true,next?.voices || null,next?.logFailed === true]),before=key(call);call=value.call || null;renderCall();if(key(call)!==before && source)render();}
        else if(value.type==='hide'){source=null;shownPhoneId=null;pendingPhone=null;messages.replaceChildren();hydrated=false;lastCurrent=null;endHandover();}
    });
})();
