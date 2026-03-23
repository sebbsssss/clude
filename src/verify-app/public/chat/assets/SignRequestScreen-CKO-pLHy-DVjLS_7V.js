import{dA as L,d7 as M,d4 as k,d9 as o,fj as N,dG as E,et as w,eu as C,d6 as t,dw as I,ds as p,ci as O,cf as z,fk as P}from"./index-DYJlS9iH.js";import{h as $}from"./CopyToClipboard-DSTf_eKU-DJqHzXXl.js";import{a as q}from"./Layouts-BlFm53ED-BEUszY8K.js";import{a as F,i as V}from"./JsonTree-aPaJmPx7-BtUCc9Zj.js";import{n as H}from"./ScreenLayout-D1p_ntex-De2NmCsz.js";import{c as J}from"./createLucideIcon-BIc87nmk.js";import"./ModalHeader-BnVmXtvG-BhMbJOlz.js";import"./Screen-Cycy3IzT-DxkoY9xr.js";import"./index-Dq_xe9dz-CtQ2Lor9.js";const G=[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]],K=J("square-pen",G),Q=p.img`
  && {
    height: ${e=>e.size==="sm"?"65px":"140px"};
    width: ${e=>e.size==="sm"?"65px":"140px"};
    border-radius: 16px;
    margin-bottom: 12px;
  }
`;let W=e=>{if(!O(e))return e;try{let a=z(e);return a.includes("�")?e:a}catch{return e}},B=e=>{try{let a=P.decode(e),s=new TextDecoder().decode(a);return s.includes("�")?e:s}catch{return e}},X=e=>{let{types:a,primaryType:s,...l}=e.typedData;return t.jsxs(t.Fragment,{children:[t.jsx(te,{data:l}),t.jsx($,{text:(i=e.typedData,JSON.stringify(i,null,2)),itemName:"full payload to clipboard"})," "]});var i};const Y=({method:e,messageData:a,copy:s,iconUrl:l,isLoading:i,success:g,walletProxyIsLoading:m,errorMessage:x,isCancellable:d,onSign:c,onCancel:y,onClose:u})=>t.jsx(H,{title:s.title,subtitle:s.description,showClose:!0,onClose:u,icon:K,iconVariant:"subtle",helpText:x?t.jsx(ee,{children:x}):void 0,primaryCta:{label:s.buttonText,onClick:c,disabled:i||g||m,loading:i},secondaryCta:d?{label:"Not now",onClick:y,disabled:i||g||m}:void 0,watermark:!0,children:t.jsxs(q,{children:[l?t.jsx(Q,{style:{alignSelf:"center"},size:"sm",src:l,alt:"app image"}):null,t.jsxs(Z,{children:[e==="personal_sign"&&t.jsx(b,{children:W(a)}),e==="eth_signTypedData_v4"&&t.jsx(X,{typedData:a}),e==="solana_signMessage"&&t.jsx(b,{children:B(a)})]})]})}),ue={component:()=>{let{authenticated:e}=L(),{initializeWalletProxy:a,closePrivyModal:s}=M(),{navigate:l,data:i,onUserCloseViaDialogOrKeybindRef:g}=k(),[m,x]=o.useState(!0),[d,c]=o.useState(""),[y,u]=o.useState(),[f,T]=o.useState(null),[j,S]=o.useState(!1);o.useEffect((()=>{e||l("LandingScreen")}),[e]),o.useEffect((()=>{a(N).then((n=>{x(!1),n||(c("An error has occurred, please try again."),u(new E(new w(d,C.E32603_DEFAULT_INTERNAL_ERROR.eipCode))))}))}),[]);let{method:R,data:_,confirmAndSign:v,onSuccess:D,onFailure:U,uiOptions:r}=i.signMessage,A={title:r?.title||"Sign message",description:r?.description||"Signing this message will not cost you any fees.",buttonText:r?.buttonText||"Sign and continue"},h=n=>{n?D(n):U(y||new E(new w("The user rejected the request.",C.E4001_USER_REJECTED_REQUEST.eipCode))),s({shouldCallAuthOnSuccess:!1}),setTimeout((()=>{T(null),c(""),u(void 0)}),200)};return g.current=()=>{h(f)},t.jsx(Y,{method:R,messageData:_,copy:A,iconUrl:r?.iconUrl&&typeof r.iconUrl=="string"?r.iconUrl:void 0,isLoading:j,success:f!==null,walletProxyIsLoading:m,errorMessage:d,isCancellable:r?.isCancellable,onSign:async()=>{S(!0),c("");try{let n=await v();T(n),S(!1),setTimeout((()=>{h(n)}),I)}catch(n){console.error(n),c("An error has occurred, please try again."),u(new E(new w(d,C.E32603_DEFAULT_INTERNAL_ERROR.eipCode))),S(!1)}},onCancel:()=>h(null),onClose:()=>h(f)})}};let Z=p.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
`,ee=p.p`
  && {
    margin: 0;
    width: 100%;
    text-align: center;
    color: var(--privy-color-error-dark);
    font-size: 14px;
    line-height: 22px;
  }
`,te=p(F)`
  margin-top: 0;
`,b=p(V)`
  margin-top: 0;
`;export{ue as SignRequestScreen,Y as SignRequestView,ue as default};
