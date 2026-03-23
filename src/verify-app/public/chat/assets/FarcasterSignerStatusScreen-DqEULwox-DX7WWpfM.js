import{cM as F,cN as T,cP as I,cR as c,db as y,cO as t,dd as x,d8 as O,d7 as o}from"./index-Br1bVXxn.js";import{h as q}from"./CopyToClipboard-DSTf_eKU-Coqsju-t.js";import{n as B}from"./OpenLink-DZHy38vr-Bmsd9nB5.js";import{C as E}from"./QrCode-B84kEIjT-BVtM0Ywp.js";import{n as M}from"./ScreenLayout-D1p_ntex-0Wt1KEE9.js";import{l as h}from"./farcaster-DPlSjvF5-D1ZnGRtH.js";import"./dijkstra-COg3n3zL.js";import"./ModalHeader-BnVmXtvG-DWMZi5qe.js";import"./Screen-Cycy3IzT-fkgceAT9.js";import"./index-Dq_xe9dz-D_4B3cL9.js";let S="#8a63d2";const P=({appName:u,loading:m,success:d,errorMessage:e,connectUri:a,onBack:r,onClose:l,onOpenFarcaster:s})=>t.jsx(M,x.isMobile||m?x.isIOS?{title:e?e.message:"Add a signer to Farcaster",subtitle:e?e.detail:`This will allow ${u} to add casts, likes, follows, and more on your behalf.`,icon:h,iconVariant:"loading",iconLoadingStatus:{success:d,fail:!!e},primaryCta:a&&s?{label:"Open Farcaster app",onClick:s}:void 0,onBack:r,onClose:l,watermark:!0}:{title:e?e.message:"Requesting signer from Farcaster",subtitle:e?e.detail:"This should only take a moment",icon:h,iconVariant:"loading",iconLoadingStatus:{success:d,fail:!!e},onBack:r,onClose:l,watermark:!0,children:a&&x.isMobile&&t.jsx(R,{children:t.jsx(B,{text:"Take me to Farcaster",url:a,color:S})})}:{title:"Add a signer to Farcaster",subtitle:`This will allow ${u} to add casts, likes, follows, and more on your behalf.`,onBack:r,onClose:l,watermark:!0,children:t.jsxs(_,{children:[t.jsx(A,{children:a?t.jsx(E,{url:a,size:275,squareLogoElement:h}):t.jsx(V,{children:t.jsx(O,{})})}),t.jsxs(N,{children:[t.jsx(L,{children:"Or copy this link and paste it into a phone browser to open the Farcaster app."}),a&&t.jsx(q,{text:a,itemName:"link",color:S})]})]})});let R=o.div`
  margin-top: 24px;
`,_=o.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`,A=o.div`
  padding: 24px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 275px;
`,N=o.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`,L=o.div`
  font-size: 0.875rem;
  text-align: center;
  color: var(--privy-color-foreground-2);
`,V=o.div`
  position: relative;
  width: 82px;
  height: 82px;
`;const Y={component:()=>{let{lastScreen:u,navigateBack:m,data:d}=F(),e=T(),{requestFarcasterSignerStatus:a,closePrivyModal:r}=I(),[l,s]=c.useState(void 0),[k,v]=c.useState(!1),[j,w]=c.useState(!1),g=c.useRef([]),n=d?.farcasterSigner;c.useEffect((()=>{let b=Date.now(),i=setInterval((async()=>{if(!n?.public_key)return clearInterval(i),void s({retryable:!0,message:"Connect failed",detail:"Something went wrong. Please try again."});n.status==="approved"&&(clearInterval(i),v(!1),w(!0),g.current.push(setTimeout((()=>r({shouldCallAuthOnSuccess:!1,isSuccess:!0})),y)));let p=await a(n?.public_key),C=Date.now()-b;p.status==="approved"?(clearInterval(i),v(!1),w(!0),g.current.push(setTimeout((()=>r({shouldCallAuthOnSuccess:!1,isSuccess:!0})),y))):C>3e5?(clearInterval(i),s({retryable:!0,message:"Connect failed",detail:"The request timed out. Try again."})):p.status==="revoked"&&(clearInterval(i),s({retryable:!0,message:"Request rejected",detail:"The request was rejected. Please try again."}))}),2e3);return()=>{clearInterval(i),g.current.forEach((p=>clearTimeout(p)))}}),[]);let f=n?.status==="pending_approval"?n.signer_approval_url:void 0;return t.jsx(P,{appName:e.name,loading:k,success:j,errorMessage:l,connectUri:f,onBack:u?m:void 0,onClose:r,onOpenFarcaster:()=>{f&&(window.location.href=f)}})}};export{Y as FarcasterSignerStatusScreen,P as FarcasterSignerStatusView,Y as default};
