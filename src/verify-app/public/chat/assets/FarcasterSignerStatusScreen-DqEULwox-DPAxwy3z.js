import{da as F,db as T,dc as I,de as c,dB as w,d4 as t,dD as x,dy as B,dx as o}from"./index-CTw60tnN.js";import{h as O}from"./CopyToClipboard-DSTf_eKU-CS7p-edJ.js";import{n as q}from"./OpenLink-DZHy38vr-BauNAtGl.js";import{C as E}from"./QrCode-B84kEIjT-DctzxCiG.js";import{n as M}from"./ScreenLayout-D1p_ntex-BEC3URo4.js";import{l as h}from"./farcaster-DPlSjvF5-CoOZjuwf.js";import"./dijkstra-COg3n3zL.js";import"./ModalHeader-BnVmXtvG-EcG3iF6i.js";import"./Screen-Cycy3IzT-B_f487Jp.js";import"./index-Dq_xe9dz-DxxtaX95.js";let S="#8a63d2";const _=({appName:d,loading:m,success:u,errorMessage:e,connectUri:a,onBack:r,onClose:l,onOpenFarcaster:s})=>t.jsx(M,x.isMobile||m?x.isIOS?{title:e?e.message:"Add a signer to Farcaster",subtitle:e?e.detail:`This will allow ${d} to add casts, likes, follows, and more on your behalf.`,icon:h,iconVariant:"loading",iconLoadingStatus:{success:u,fail:!!e},primaryCta:a&&s?{label:"Open Farcaster app",onClick:s}:void 0,onBack:r,onClose:l,watermark:!0}:{title:e?e.message:"Requesting signer from Farcaster",subtitle:e?e.detail:"This should only take a moment",icon:h,iconVariant:"loading",iconLoadingStatus:{success:u,fail:!!e},onBack:r,onClose:l,watermark:!0,children:a&&x.isMobile&&t.jsx(A,{children:t.jsx(q,{text:"Take me to Farcaster",url:a,color:S})})}:{title:"Add a signer to Farcaster",subtitle:`This will allow ${d} to add casts, likes, follows, and more on your behalf.`,onBack:r,onClose:l,watermark:!0,children:t.jsxs(P,{children:[t.jsx(R,{children:a?t.jsx(E,{url:a,size:275,squareLogoElement:h}):t.jsx(N,{children:t.jsx(B,{})})}),t.jsxs(D,{children:[t.jsx(L,{children:"Or copy this link and paste it into a phone browser to open the Farcaster app."}),a&&t.jsx(O,{text:a,itemName:"link",color:S})]})]})});let A=o.div`
  margin-top: 24px;
`,P=o.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`,R=o.div`
  padding: 24px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 275px;
`,D=o.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`,L=o.div`
  font-size: 0.875rem;
  text-align: center;
  color: var(--privy-color-foreground-2);
`,N=o.div`
  position: relative;
  width: 82px;
  height: 82px;
`;const Y={component:()=>{let{lastScreen:d,navigateBack:m,data:u}=F(),e=T(),{requestFarcasterSignerStatus:a,closePrivyModal:r}=I(),[l,s]=c.useState(void 0),[k,v]=c.useState(!1),[j,y]=c.useState(!1),g=c.useRef([]),n=u?.farcasterSigner;c.useEffect((()=>{let b=Date.now(),i=setInterval((async()=>{if(!n?.public_key)return clearInterval(i),void s({retryable:!0,message:"Connect failed",detail:"Something went wrong. Please try again."});n.status==="approved"&&(clearInterval(i),v(!1),y(!0),g.current.push(setTimeout((()=>r({shouldCallAuthOnSuccess:!1,isSuccess:!0})),w)));let p=await a(n?.public_key),C=Date.now()-b;p.status==="approved"?(clearInterval(i),v(!1),y(!0),g.current.push(setTimeout((()=>r({shouldCallAuthOnSuccess:!1,isSuccess:!0})),w))):C>3e5?(clearInterval(i),s({retryable:!0,message:"Connect failed",detail:"The request timed out. Try again."})):p.status==="revoked"&&(clearInterval(i),s({retryable:!0,message:"Request rejected",detail:"The request was rejected. Please try again."}))}),2e3);return()=>{clearInterval(i),g.current.forEach((p=>clearTimeout(p)))}}),[]);let f=n?.status==="pending_approval"?n.signer_approval_url:void 0;return t.jsx(_,{appName:e.name,loading:k,success:j,errorMessage:l,connectUri:f,onBack:d?m:void 0,onClose:r,onOpenFarcaster:()=>{f&&(window.location.href=f)}})}};export{Y as FarcasterSignerStatusScreen,_ as FarcasterSignerStatusView,Y as default};
