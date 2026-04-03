import{aq as A,ap as M,an as N,al as o,eo as k,cu as E,em as C,en as T,am as t,c4 as I,ar as p,a3 as O,ae as q,ep as z}from"./index-C5ltmIwg.js";import{h as P}from"./CopyToClipboard-DSTf_eKU-CWKeZtj9.js";import{a as $}from"./Layouts-BlFm53ED-Cl-jVgTB.js";import{a as F,i as V}from"./JsonTree-aPaJmPx7-Nt-xZt3s.js";import{n as H}from"./ScreenLayout-D1p_ntex-zQJzln9L.js";import{c as J}from"./createLucideIcon-bRcOMvfd.js";import"./ModalHeader-BnVmXtvG-BcKBQfIN.js";import"./Screen-Cycy3IzT-CRRvO9tN.js";import"./index-Dq_xe9dz-CSuLitfE.js";const K=[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]],Q=J("square-pen",K),W=p.img`
  && {
    height: ${e=>e.size==="sm"?"65px":"140px"};
    width: ${e=>e.size==="sm"?"65px":"140px"};
    border-radius: 16px;
    margin-bottom: 12px;
  }
`;let B=e=>{if(!O(e))return e;try{let a=q(e);return a.includes("�")?e:a}catch{return e}},G=e=>{try{let a=z.decode(e),s=new TextDecoder().decode(a);return s.includes("�")?e:s}catch{return e}},X=e=>{let{types:a,primaryType:s,...l}=e.typedData;return t.jsxs(t.Fragment,{children:[t.jsx(te,{data:l}),t.jsx(P,{text:(i=e.typedData,JSON.stringify(i,null,2)),itemName:"full payload to clipboard"})," "]});var i};const Y=({method:e,messageData:a,copy:s,iconUrl:l,isLoading:i,success:g,walletProxyIsLoading:m,errorMessage:x,isCancellable:d,onSign:c,onCancel:y,onClose:u})=>t.jsx(H,{title:s.title,subtitle:s.description,showClose:!0,onClose:u,icon:Q,iconVariant:"subtle",helpText:x?t.jsx(ee,{children:x}):void 0,primaryCta:{label:s.buttonText,onClick:c,disabled:i||g||m,loading:i},secondaryCta:d?{label:"Not now",onClick:y,disabled:i||g||m}:void 0,watermark:!0,children:t.jsxs($,{children:[l?t.jsx(W,{style:{alignSelf:"center"},size:"sm",src:l,alt:"app image"}):null,t.jsxs(Z,{children:[e==="personal_sign"&&t.jsx(w,{children:B(a)}),e==="eth_signTypedData_v4"&&t.jsx(X,{typedData:a}),e==="solana_signMessage"&&t.jsx(w,{children:G(a)})]})]})}),ue={component:()=>{let{authenticated:e}=A(),{initializeWalletProxy:a,closePrivyModal:s}=M(),{navigate:l,data:i,onUserCloseViaDialogOrKeybindRef:g}=N(),[m,x]=o.useState(!0),[d,c]=o.useState(""),[y,u]=o.useState(),[f,b]=o.useState(null),[R,S]=o.useState(!1);o.useEffect((()=>{e||l("LandingScreen")}),[e]),o.useEffect((()=>{a(k).then((n=>{x(!1),n||(c("An error has occurred, please try again."),u(new E(new C(d,T.E32603_DEFAULT_INTERNAL_ERROR.eipCode))))}))}),[]);let{method:_,data:j,confirmAndSign:v,onSuccess:D,onFailure:U,uiOptions:r}=i.signMessage,L={title:r?.title||"Sign message",description:r?.description||"Signing this message will not cost you any fees.",buttonText:r?.buttonText||"Sign and continue"},h=n=>{n?D(n):U(y||new E(new C("The user rejected the request.",T.E4001_USER_REJECTED_REQUEST.eipCode))),s({shouldCallAuthOnSuccess:!1}),setTimeout((()=>{b(null),c(""),u(void 0)}),200)};return g.current=()=>{h(f)},t.jsx(Y,{method:_,messageData:j,copy:L,iconUrl:r?.iconUrl&&typeof r.iconUrl=="string"?r.iconUrl:void 0,isLoading:R,success:f!==null,walletProxyIsLoading:m,errorMessage:d,isCancellable:r?.isCancellable,onSign:async()=>{S(!0),c("");try{let n=await v();b(n),S(!1),setTimeout((()=>{h(n)}),I)}catch(n){console.error(n),c("An error has occurred, please try again."),u(new E(new C(d,T.E32603_DEFAULT_INTERNAL_ERROR.eipCode))),S(!1)}},onCancel:()=>h(null),onClose:()=>h(f)})}};let Z=p.div`
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
