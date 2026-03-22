import{cR as a,df as A,cP as B,cN as W,cM as L,cO as t,d7 as f,dy as U}from"./index-K9D-k8CQ.js";import{t as R}from"./WarningBanner-D5LqDt95-CoZWo4FG.js";import{j as $}from"./WalletInfoCard-CEcdukTg-DYsS9JNB.js";import{n as O}from"./ScreenLayout-D1p_ntex-BddHjKjp.js";import"./ExclamationTriangleIcon-DD0uk6IF.js";import"./ModalHeader-BnVmXtvG-Nz3STb3h.js";import"./ErrorMessage-D8VaAP5m-CJlcRxhP.js";import"./LabelXs-oqZNqbm_-CEaLZJhu.js";import"./Address-N-mzBgMy-DSlR7Gnh.js";import"./check-R0Kqzvak.js";import"./createLucideIcon-CTKDiqtm.js";import"./copy-BgQr_uM_.js";import"./shared-FM0rljBt-S8Om2xzu.js";import"./Screen-Cycy3IzT-AInDupKi.js";import"./index-Dq_xe9dz-Xupo7JJd.js";const K=({address:e,accessToken:o,appConfigTheme:l,onClose:s,exportButtonProps:i,onBack:n})=>t.jsx(O,{title:"Export wallet",subtitle:t.jsxs(t.Fragment,{children:["Copy either your private key or seed phrase to export your wallet."," ",t.jsx("a",{href:"https://privy-io.notion.site/Transferring-your-account-9dab9e16c6034a7ab1ff7fa479b02828",target:"blank",rel:"noopener noreferrer",children:"Learn more"})]}),onClose:s,onBack:n,showBack:!!n,watermark:!0,children:t.jsxs(M,{children:[t.jsx(R,{theme:l,children:"Never share your private key or seed phrase with anyone."}),t.jsx($,{title:"Your wallet",address:e,showCopyButton:!0}),t.jsx("div",{style:{width:"100%"},children:o&&i&&t.jsx(N,{accessToken:o,dimensions:{height:"44px"},...i})})]})});let M=f.div`
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: left;
`;function N(e){let[o,l]=a.useState(e.dimensions.width),[s,i]=a.useState(!1),[n,p]=a.useState(void 0),d=a.useRef(null);a.useEffect((()=>{if(d.current&&o===void 0){let{width:u}=d.current.getBoundingClientRect();l(u)}let r=getComputedStyle(document.documentElement);p({background:r.getPropertyValue("--privy-color-background"),background2:r.getPropertyValue("--privy-color-background-2"),foreground3:r.getPropertyValue("--privy-color-foreground-3"),foregroundAccent:r.getPropertyValue("--privy-color-foreground-accent"),accent:r.getPropertyValue("--privy-color-accent"),accentDark:r.getPropertyValue("--privy-color-accent-dark"),success:r.getPropertyValue("--privy-color-success"),colorScheme:r.getPropertyValue("color-scheme")})}),[]);let c=e.chainType==="ethereum"&&!e.imported&&!e.isUnifiedWallet;return t.jsx("div",{ref:d,children:o&&t.jsxs(z,{children:[t.jsx("iframe",{style:{position:"absolute",zIndex:1,opacity:s?1:0,transition:"opacity 50ms ease-in-out",pointerEvents:s?"auto":"none"},onLoad:()=>setTimeout((()=>i(!0)),1500),width:o,height:e.dimensions.height,allow:"clipboard-write self *",src:U({origin:e.origin,path:`/apps/${e.appId}/embedded-wallets/export`,query:e.isUnifiedWallet?{v:"1-unified",wallet_id:e.walletId,client_id:e.appClientId,width:`${o}px`,caid:e.clientAnalyticsId,phrase_export:c,...n}:{v:"1",entropy_id:e.entropyId,entropy_id_verifier:e.entropyIdVerifier,hd_wallet_index:e.hdWalletIndex,chain_type:e.chainType,client_id:e.appClientId,width:`${o}px`,caid:e.clientAnalyticsId,phrase_export:c,...n},hash:{token:e.accessToken}})}),t.jsx(x,{children:"Loading..."}),c&&t.jsx(x,{children:"Loading..."})]})})}const ne={component:()=>{let[e,o]=a.useState(null),{authenticated:l,user:s}=A(),{closePrivyModal:i,createAnalyticsEvent:n,clientAnalyticsId:p,client:d}=B(),c=W(),{data:r,onUserCloseViaDialogOrKeybindRef:u}=L(),{onFailure:v,onSuccess:w,origin:k,appId:I,appClientId:b,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:E,chainType:P,address:m,isUnifiedWallet:T,imported:V,showBackButton:S}=r.keyExport,g=y=>{i({shouldCallAuthOnSuccess:!1}),v(typeof y=="string"?Error(y):y)},h=()=>{i({shouldCallAuthOnSuccess:!1}),w(),n({eventName:"embedded_wallet_key_export_completed",payload:{walletAddress:m}})};return a.useEffect((()=>{if(!l)return g("User must be authenticated before exporting their wallet");d.getAccessToken().then(o).catch(g)}),[l,s]),u.current=h,t.jsx(K,{address:m,accessToken:e,appConfigTheme:c.appearance.palette.colorScheme,onClose:h,isLoading:!e,onBack:S?h:void 0,exportButtonProps:e?{origin:k,appId:I,appClientId:b,clientAnalyticsId:p,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:E,isUnifiedWallet:T,imported:V,chainType:P}:void 0})}};let z=f.div`
  overflow: visible;
  position: relative;
  overflow: none;
  height: 44px;
  display: flex;
  gap: 12px;
`,x=f.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  font-weight: 500;
  border-radius: var(--privy-border-radius-md);
  background-color: var(--privy-color-background-2);
  color: var(--privy-color-foreground-3);
`;export{ne as EmbeddedWalletKeyExportScreen,K as EmbeddedWalletKeyExportView,ne as default};
