import{dF as A,dc as M,da as N,de as r,fo as k,dL as E,ey as C,ez as T,d4 as t,dB as z,dx as p,ci as I,cf as O,fp as P}from"./index-CxgUv6vE.js";import{h as $}from"./CopyToClipboard-DSTf_eKU-CauqRKEp.js";import{a as q}from"./Layouts-BlFm53ED-BbqOuiPV.js";import{a as F,i as V}from"./JsonTree-aPaJmPx7-9DyMiqC6.js";import{n as H}from"./ScreenLayout-D1p_ntex-DQNeglxC.js";import{c as J}from"./createLucideIcon-IQGcnTjC.js";import"./ModalHeader-BnVmXtvG-Dswx7FSG.js";import"./Screen-Cycy3IzT-C9soLlRm.js";import"./index-Dq_xe9dz-Bo6HQ4fD.js";const B=[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]],K=J("square-pen",B),Q=p.img`
  && {
    height: ${e=>e.size==="sm"?"65px":"140px"};
    width: ${e=>e.size==="sm"?"65px":"140px"};
    border-radius: 16px;
    margin-bottom: 12px;
  }
`;let W=e=>{if(!I(e))return e;try{let a=O(e);return a.includes("�")?e:a}catch{return e}},G=e=>{try{let a=P.decode(e),s=new TextDecoder().decode(a);return s.includes("�")?e:s}catch{return e}},X=e=>{let{types:a,primaryType:s,...l}=e.typedData;return t.jsxs(t.Fragment,{children:[t.jsx(te,{data:l}),t.jsx($,{text:(i=e.typedData,JSON.stringify(i,null,2)),itemName:"full payload to clipboard"})," "]});var i};const Y=({method:e,messageData:a,copy:s,iconUrl:l,isLoading:i,success:g,walletProxyIsLoading:m,errorMessage:x,isCancellable:d,onSign:c,onCancel:y,onClose:u})=>t.jsx(H,{title:s.title,subtitle:s.description,showClose:!0,onClose:u,icon:K,iconVariant:"subtle",helpText:x?t.jsx(ee,{children:x}):void 0,primaryCta:{label:s.buttonText,onClick:c,disabled:i||g||m,loading:i},secondaryCta:d?{label:"Not now",onClick:y,disabled:i||g||m}:void 0,watermark:!0,children:t.jsxs(q,{children:[l?t.jsx(Q,{style:{alignSelf:"center"},size:"sm",src:l,alt:"app image"}):null,t.jsxs(Z,{children:[e==="personal_sign"&&t.jsx(w,{children:W(a)}),e==="eth_signTypedData_v4"&&t.jsx(X,{typedData:a}),e==="solana_signMessage"&&t.jsx(w,{children:G(a)})]})]})}),ue={component:()=>{let{authenticated:e}=A(),{initializeWalletProxy:a,closePrivyModal:s}=M(),{navigate:l,data:i,onUserCloseViaDialogOrKeybindRef:g}=N(),[m,x]=r.useState(!0),[d,c]=r.useState(""),[y,u]=r.useState(),[f,b]=r.useState(null),[R,S]=r.useState(!1);r.useEffect((()=>{e||l("LandingScreen")}),[e]),r.useEffect((()=>{a(k).then((n=>{x(!1),n||(c("An error has occurred, please try again."),u(new E(new C(d,T.E32603_DEFAULT_INTERNAL_ERROR.eipCode))))}))}),[]);let{method:_,data:j,confirmAndSign:v,onSuccess:D,onFailure:L,uiOptions:o}=i.signMessage,U={title:o?.title||"Sign message",description:o?.description||"Signing this message will not cost you any fees.",buttonText:o?.buttonText||"Sign and continue"},h=n=>{n?D(n):L(y||new E(new C("The user rejected the request.",T.E4001_USER_REJECTED_REQUEST.eipCode))),s({shouldCallAuthOnSuccess:!1}),setTimeout((()=>{b(null),c(""),u(void 0)}),200)};return g.current=()=>{h(f)},t.jsx(Y,{method:_,messageData:j,copy:U,iconUrl:o?.iconUrl&&typeof o.iconUrl=="string"?o.iconUrl:void 0,isLoading:R,success:f!==null,walletProxyIsLoading:m,errorMessage:d,isCancellable:o?.isCancellable,onSign:async()=>{S(!0),c("");try{let n=await v();b(n),S(!1),setTimeout((()=>{h(n)}),z)}catch(n){console.error(n),c("An error has occurred, please try again."),u(new E(new C(d,T.E32603_DEFAULT_INTERNAL_ERROR.eipCode))),S(!1)}},onCancel:()=>h(null),onClose:()=>h(f)})}};let Z=p.div`
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
`,w=p(V)`
  margin-top: 0;
`;export{ue as SignRequestScreen,Y as SignRequestView,ue as default};
