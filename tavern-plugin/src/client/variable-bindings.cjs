// explicit dependencies, safe to include in any feature closure.
function createVariableBindingsClient({React,rpc,signals}) {
    function useCardVariables({path,sessionId,targets,enabled=true}) {
        const key=JSON.stringify([path,sessionId,targets,enabled]);
        const [state,setState]=React.useState({key:null,loading:false,error:null,data:null});
        const [generation,refresh]=React.useReducer(value=>value+1,0);
        React.useEffect(()=>{
            if (!enabled || !path || !sessionId) return;
            let live=true,sequence=0;
            const read=async()=>{
                const request=++sequence;
                setState(previous=>({key,loading:true,error:null,data:previous.key===key?previous.data:null}));
                try {
                    const data=await rpc('readCardVariables',{path,sessionId,...(targets?{targets}:{})},sessionId);
                    if(live && request===sequence)setState({key,loading:false,error:null,data});
                } catch(error) {
                    if(live && request===sequence)setState({key,loading:false,error,data:null});
                }
            };
            void read();
            const stop=signals?.subscribe(sessionId,'tavern-state',read,read,read);
            return()=>{live=false;stop?.();};
        },[key,generation]);
        return {...(state.key===key?state:{loading:enabled && !!path && !!sessionId,error:null,data:null}),refresh};
    }
    return {useCardVariables};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports={createVariableBindingsClient};
