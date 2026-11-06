// Legacy Helper APIs return synchronously. Recent rows are already local; an
// explicit old-floor read uses a narrow, revision-pinned read-only capability.
// Never return a placeholder as if it were a real historical message.
function createTavernHistoryReader({context,install,request}) {
    function remote(args) {
        const xhr = new XMLHttpRequest();
        const url = new URL('/api/dsh-tavern/helper-history', document.baseURI);
        url.searchParams.set('cap',args.token);
        url.searchParams.set('from',String(args.from));
        url.searchParams.set('to',String(args.to));
        xhr.open('GET',url.href,false);
        xhr.send();
        if(xhr.status!==200)throw new Error('历史读取失败，请刷新会话后重试');
        return JSON.parse(xhr.responseText);
    }
    return function read(id) {
        const state=context(), row=state.messages && state.messages[id];
        if(!row || !row.stub)return row;
        const access=state.historyAccess;
        if(!access)throw new Error('历史消息尚未加载');
        const result=(request || remote)({token:access.token,revision:access.revision,from:id,to:id});
        const loaded=result.messages && result.messages[0];
        if(!Array.isArray(result?.messages) || result.revision!==access.revision || result.messages.length!==1 || loaded?.message_id!==id || loaded.stub)throw new Error('历史消息版本不匹配');
        install(loaded);
        return loaded;
    };
}
