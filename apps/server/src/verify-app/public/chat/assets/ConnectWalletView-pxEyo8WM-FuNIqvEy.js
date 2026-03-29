import{r as v,a8 as ue,af as he,cU as De,ax as S,cV as je,cW as Pe,c1 as Qe,aB as z,cX as Re,cY as Ce,j as t,ab as Ve,cZ as Ge,c_ as He,c$ as Ye,d0 as se,d1 as We,d2 as ze,bJ as k,ay as Te}from"./vendor-privy-D-qEdLrY.js";import{y as ke,h as Ze}from"./ModalHeader-BnVmXtvG-nKy1GoVW.js";import{m as Je}from"./CopyableText-BCytXyJL-1aALqypg.js";import{n as Xe}from"./Link-DJ5gq9Di-C1JwVBE2.js";import{C as Oe}from"./QrCode-B84kEIjT-BeRohmiA.js";import{e as et}from"./EmailInputForm-Dgoii4vf-Dwr-QWZ8.js";import{n as pe}from"./useI18n-C4fmUAf3-DwRvPo8p.js";import{e as tt}from"./WalletCards-DH1rqayz-BJQu7DMR.js";import{w as G}from"./Screen-Cycy3IzT-wOMWdYJj.js";function nt({title:g,titleId:l,...d},p){return v.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:p,"aria-labelledby":l},d),g?v.createElement("title",{id:l},g):null,v.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"}))}const lt=v.forwardRef(nt),H={phantom:{mobile:{native:"phantom://",universal:"https://phantom.app/ul/"}},solflare:{mobile:{native:void 0,universal:"https://solflare.com/ul/v1/"}},metamask:{image_url:{sm:Ce,md:Ce}}};class h{static normalize(l){return l.replace(/[-_]wallet$/,"").replace(/[-_]extension$/,"").toLowerCase()}isEth(l){return l.chains.some((d=>d.includes("eip155:")))}isSol(l){return l.chains.some((d=>d.includes("solana:")))}inAllowList(l,d){if(!this.normalizedAllowList||this.normalizedAllowList.length===0||d==="listing"&&this.includeWalletConnect)return!0;let p=h.normalize(l);return this.normalizedAllowList.some((r=>p===h.normalize(r)))}inDenyList(l,d){return d==="listing"&&l==="rabby"||h.normalize(l)==="agw"}chainMatches(l){return this.chainFilter==="ethereum-only"?l==="ethereum":this.chainFilter!=="solana-only"||l==="solana"}getAllowListKey(l,d,p,r){let x=h.normalize(l);for(let C of this.normalizedAllowList||[])if(x===h.normalize(C))return C;if(d==="connector"){if((p==="injected"||p==="solana_adapter")&&r==="ethereum"&&this.detectedEth)return"detected_ethereum_wallets";if((p==="injected"||p==="solana_adapter")&&r==="solana"&&this.detectedSol)return"detected_solana_wallets"}if(d==="listing"&&this.includeWalletConnect)return"wallet_connect"}connectorOk(l){return!!(l.connectorType!=="null"&&l.walletBranding.id!=="walletconnect_solana"&&this.chainMatches(l.chainType)&&(this.inAllowList(l.walletClientType,"connector")||(l.connectorType==="injected"||l.connectorType==="solana_adapter")&&(l.chainType==="ethereum"&&this.detectedEth||l.chainType==="solana"&&this.detectedSol)))}listingOk(l){if(l.slug.includes("coinbase"))return!1;if(this.chainFilter==="ethereum-only"){if(!this.isEth(l))return!1}else if(this.chainFilter==="solana-only"&&!this.isSol(l))return!1;return!(!this.inAllowList(l.slug,"listing")||this.inDenyList(l.slug,"listing"))}getWallets(l,d){let p=new Map,r=n=>{let i=p.get(n.id);if(i){i.chainType!==n.chainType&&(i.chainType="multi");let u=new Set(i.chains);n.chains.forEach((m=>u.add(m))),i.chains=Array.from(u),!i.icon&&n.icon&&(i.icon=n.icon),!i.url&&n.url&&(i.url=n.url),!i.listing&&n.listing&&(i.listing=n.listing),!i.allowListKey&&n.allowListKey&&(i.allowListKey=n.allowListKey)}else p.set(n.id,n)};l.filter((n=>this.connectorOk(n))).forEach((n=>{let i=h.normalize(n.walletClientType);r({id:i,label:n.walletBranding?.name??i,source:"connector",connector:n,chainType:n.chainType,icon:n.walletBranding?.icon,url:void 0,chains:[n.chainType==="ethereum"?"eip155":"solana"],allowListKey:this.getAllowListKey(n.walletClientType,"connector",n.connectorType,n.chainType)})}));let x=l.find((n=>n.connectorType==="wallet_connect_v2")),C=l.find((n=>n.walletBranding.id==="walletconnect_solana"));d.filter((n=>this.listingOk(n))).forEach((n=>{let i=[...n.chains].filter((o=>o.includes("eip155:")||o.includes("solana:")));if(l.some((o=>h.normalize(o.walletClientType)===h.normalize(n.slug)&&o.chainType==="ethereum"&&o.connectorType!=="null"))||x||n.mobile.native||n.mobile.universal||se[n.slug]?.chainTypes.includes("ethereum")||(i=i.filter((o=>!o.includes("eip155:")))),l.some((o=>h.normalize(o.walletClientType)===h.normalize(n.slug)&&o.chainType==="solana"&&o.connectorType!=="null"))||C||n.mobile.native||n.mobile.universal||se[n.slug]?.chainTypes.includes("solana")||(i=i.filter((o=>!o.includes("solana:")))),!i.length)return;let u=h.normalize(n.slug),m=H[n.slug],T=m?.image_url?.sm||n.image_url?.sm;i.some((o=>o.includes("eip155:")))&&r({id:u,label:n.name||u,source:"listing",listing:n,chainType:"ethereum",icon:T,url:n.homepage,chains:i,allowListKey:this.getAllowListKey(n.slug,"listing")}),i.some((o=>o.includes("solana:")))&&r({id:u,label:n.name||u,source:"listing",listing:n,chainType:"solana",icon:T,url:n.homepage,chains:i,allowListKey:this.getAllowListKey(n.slug,"listing")})})),this.includeWalletConnectQr&&x&&r({id:"wallet_connect_qr",label:"WalletConnect",source:"connector",connector:x,chainType:"ethereum",icon:Te,url:void 0,chains:["eip155"],allowListKey:"wallet_connect_qr"}),this.includeWalletConnectQrSolana&&C&&r({id:"wallet_connect_qr_solana",label:"WalletConnect",source:"connector",connector:C,chainType:"solana",icon:Te,url:void 0,chains:["solana"],allowListKey:"wallet_connect_qr_solana"});let w=Array.from(p.values());w.forEach((n=>{let i=H[n.listing?.slug||n.id];i?.image_url?.sm&&(n.icon=i.image_url.sm)}));let b=new Map;return this.normalizedAllowList?.forEach(((n,i)=>{b.set(h.normalize(n),i)})),{wallets:w.slice().sort(((n,i)=>{if(n.allowListKey&&i.allowListKey){let M=this.normalizedAllowList?.findIndex((L=>h.normalize(L)===h.normalize(n.allowListKey)))??-1,s=this.normalizedAllowList?.findIndex((L=>h.normalize(L)===h.normalize(i.allowListKey)))??-1;if(M!==s&&M>=0&&s>=0)return M-s}if(n.allowListKey&&!i.allowListKey)return-1;if(!n.allowListKey&&i.allowListKey)return 1;let u=h.normalize(n.id),m=h.normalize(i.id);u==="binance-defi"?u="binance":u==="universalprofiles"?u="universal_profile":u==="cryptocom-defi"?u="cryptocom":u==="bitkeep"&&(u="bitget_wallet"),m==="binance-defi"?m="binance":m==="universalprofiles"?m="universal_profile":m==="cryptocom-defi"?m="cryptocom":m==="bitkeep"&&(m="bitget_wallet");let T=b.has(u),o=b.has(m);return T&&o?b.get(u)-b.get(m):T?-1:o?1:n.source==="connector"&&i.source==="listing"?-1:n.source==="listing"&&i.source==="connector"?1:n.label.toLowerCase().localeCompare(i.label.toLowerCase())})),walletCount:w.length}}constructor(l,d){this.chainFilter=l,d&&d.length>0&&(this.normalizedAllowList=d.map(String),this.normalizedAllowList.includes("binance")&&this.normalizedAllowList.push("binance-defi-wallet"),this.normalizedAllowList.includes("bitget_wallet")&&this.normalizedAllowList.push("bitkeep")),this.detectedEth=this.normalizedAllowList?.includes("detected_ethereum_wallets")??!1,this.detectedSol=this.normalizedAllowList?.includes("detected_solana_wallets")??!1,this.includeWalletConnect=this.normalizedAllowList?.includes("wallet_connect")??!1,this.includeWalletConnectQr=this.normalizedAllowList?.includes("wallet_connect_qr")??!1,this.includeWalletConnectQrSolana=this.normalizedAllowList?.includes("wallet_connect_qr_solana")??!1}}var me=g=>t.jsxs("svg",{viewBox:"0 0 32 32",xmlns:"http://www.w3.org/2000/svg",...g,children:[t.jsx("path",{d:"m0 0h32v32h-32z",fill:"#5469d4"}),t.jsx("path",{d:"m15.997 5.333-.143.486v14.106l.143.143 6.548-3.87z",fill:"#c2ccf4"}),t.jsx("path",{d:"m15.996 5.333-6.548 10.865 6.548 3.87z",fill:"#fff"}),t.jsx("path",{d:"m15.997 21.306-.08.098v5.025l.08.236 6.552-9.227z",fill:"#c2ccf4"}),t.jsx("path",{d:"m15.996 26.665v-5.36l-6.548-3.867z",fill:"#fff"}),t.jsx("path",{d:"m15.995 20.07 6.548-3.87-6.548-2.976v6.847z",fill:"#8698e8"}),t.jsx("path",{d:"m9.448 16.2 6.548 3.87v-6.846z",fill:"#c2ccf4"})]}),ge=g=>t.jsxs("svg",{viewBox:"0 0 32 32",xmlns:"http://www.w3.org/2000/svg",...g,children:[t.jsxs("linearGradient",{id:"a",gradientUnits:"userSpaceOnUse",x1:"7.233",x2:"24.766",y1:"24.766",y2:"7.234",children:[t.jsx("stop",{offset:"0",stopColor:"#9945ff"}),t.jsx("stop",{offset:".2",stopColor:"#7962e7"}),t.jsx("stop",{offset:"1",stopColor:"#00d18c"})]}),t.jsx("path",{d:"m0 0h32v32h-32z",fill:"#10111a"}),t.jsx("path",{clipRule:"evenodd",d:"m9.873 20.41a.645.645 0 0 1 .476-.21l14.662.012a.323.323 0 0 1 .238.54l-3.123 3.438a.643.643 0 0 1 -.475.21l-14.662-.012a.323.323 0 0 1 -.238-.54zm15.376-2.862a.322.322 0 0 1 -.238.54l-14.662.012a.642.642 0 0 1 -.476-.21l-3.122-3.44a.323.323 0 0 1 .238-.54l14.662-.012a.644.644 0 0 1 .475.21zm-15.376-9.738a.644.644 0 0 1 .476-.21l14.662.012a.322.322 0 0 1 .238.54l-3.123 3.438a.643.643 0 0 1 -.475.21l-14.662-.012a.323.323 0 0 1 -.238-.54z",fill:"url(#a)",fillRule:"evenodd"})]});k.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;k.button`
  padding: 0.25rem;
  height: 30px;
  width: 30px;

  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--privy-border-radius-full);
  background: var(--privy-color-background-2);
`;const it=k.div`
  position: relative;
  display: inline-flex;
  align-items: center;

  &::after {
    content: ' ';
    border-radius: var(--privy-border-radius-full);
    height: 6px;
    width: 6px;
    background-color: var(--privy-color-icon-success);
    position: absolute;
    right: -3px;
    top: -3px;
  }
`,O=k.img`
  width: 32px;
  height: 32px;
  border-radius: 0.25rem;
  object-fit: contain;
`,at=k.span`
  display: flex;
  gap: 0.25rem;
  align-items: center;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.125rem; /* 150% */
  border-radius: var(--privy-border-radius-sm);
  background-color: var(--privy-color-background-2);

  svg {
    width: 100%;
    max-width: 1rem;
    max-height: 1rem;
    stroke-width: 2;
  }
`;k.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 24rem;
  overflow-y: scroll;

  &::-webkit-scrollbar {
    display: none;
  }

  scrollbar-gutter: stable both-edges;
  scrollbar-width: none;
  -ms-overflow-style: none;

  ${g=>g.$colorScheme==="light"?"background: linear-gradient(var(--privy-color-background), var(--privy-color-background) 70%) bottom, linear-gradient(rgba(0, 0, 0, 0) 20%, rgba(0, 0, 0, 0.06)) bottom;":g.$colorScheme==="dark"?"background: linear-gradient(var(--privy-color-background), var(--privy-color-background) 70%) bottom, linear-gradient(rgba(255, 255, 255, 0) 20%, rgba(255, 255, 255, 0.06)) bottom;":void 0}

  background-repeat: no-repeat;
  background-size:
    100% 32px,
    100% 16px;
  background-attachment: local, scroll;
`;function ot({enabled:g=!0,walletList:l,walletChainType:d}){let p=ue(),{connectors:r}=he(),{listings:x,loading:C}=Ye(g),w=d??p.appearance.walletChainType,b=l??p.appearance?.walletList,n=v.useMemo((()=>new h(w,b)),[w,b]),{wallets:i,walletCount:u}=v.useMemo((()=>n.getWallets(r,x)),[n,r,x]),[m,T]=v.useState(""),o=v.useMemo((()=>m?i.filter((L=>L.label.toLowerCase().includes(m.toLowerCase()))):i),[m,i]),[M,s]=v.useState();return{selected:M,setSelected:s,search:m,setSearch:T,loadingListings:C,wallets:o,walletCount:u}}let ae=g=>!g||typeof g!="string"&&(g instanceof We||g instanceof ze);const rt=({index:g,style:l,data:d,recent:p})=>{let r=d.wallets[g],{walletChainType:x,handleWalletClick:C}=d,{t:w}=pe(),b={...l,boxSizing:"border-box"};return r?t.jsxs(oe,{style:b,onClick:()=>C(r),children:[r.icon&&(r.connector&&!ae(r.connector)?t.jsx(it,{children:typeof r.icon=="string"?t.jsx(O,{src:r.icon}):t.jsx(r.icon,{style:{width:"32px",height:"32px"}})}):typeof r.icon=="string"?t.jsx(O,{src:r.icon}):t.jsx(r.icon,{style:{width:"32px",height:"32px"}})),t.jsx(re,{children:r.label}),p?t.jsxs(t.Fragment,{children:[t.jsx(at,{children:w("connectWallet.lastUsed")}),t.jsx(ce,{children:t.jsxs(t.Fragment,{children:[x==="ethereum-only"&&t.jsx(me,{}),x==="solana-only"&&t.jsx(ge,{})]})})]}):t.jsx(ce,{children:!(x==="ethereum-only"||x==="solana-only")&&t.jsxs(t.Fragment,{children:[r.chains?.some((n=>n.startsWith("eip155")))&&t.jsx(me,{}),r.chains?.some((n=>n.startsWith("solana")))&&t.jsx(ge,{})]})})]}):null};var bt=({className:g,customDescription:l,connectOnly:d,preSelectedWalletId:p,hideHeader:r,...x})=>{let C=ue(),{t:w}=pe(),{connectors:b}=he(),n=x.walletChainType||C.appearance.walletChainType,i=x.walletList||C.appearance?.walletList,{onBack:u,onClose:m,app:T}=x,{selected:o,setSelected:M,qrUrl:s,setQrUrl:L,connecting:a,uiState:D,errorCode:_e,wallets:ee,walletCount:de,handleConnect:A,handleBack:Se,showSearchBar:Ae,isInitialConnectView:P,title:Ee,search:$e,setSearch:Me}=(function({onConnect:e,onBack:B,onClose:Y,onConnectError:Z,walletList:J,walletChainType:ne,app:le}){let I=ue(),{connectors:c}=he(),{t:W}=pe(),{wallets:_,walletCount:X,search:ye,setSearch:Be,selected:Q,setSelected:ve}=ot({enabled:De(J??[]),walletList:J,walletChainType:ne}),[R,K]=v.useState(),[Ke,F]=v.useState(),[U,xe]=v.useState(),[f,V]=v.useState(),be=!Q&&!U&&!f,Ue=be&&(X>6||ye.length>0),ie=c.find((y=>y.connectorType==="wallet_connect_v2")),Ne=v.useCallback((async(y,N)=>{if(!y)return;let q=N?.name??"Wallet";if(f?.connector!==y||R!=="loading"){if(K("loading"),typeof y=="string")return S.debug("Connecting wallet via deeplink",{wallet:q,url:y.length>80?`${y.slice(0,80)}...`:y}),V({connector:y,name:q,icon:N?.icon,id:N?.id,url:N?.url}),void window.open(y,"_blank");S.debug("Connecting wallet via connector",{wallet:q,connectorType:y.connectorType}),V({connector:y,name:N?.name??y.walletBranding.name??"Wallet",icon:N?.icon??y.walletBranding.icon,id:N?.id,url:N?.url});try{let j=await y.connect({showPrompt:!0});if(!j)return S.warn("Wallet connection returned null",{wallet:q,connectorType:y.connectorType}),K("error"),F(void 0),void Z?.(new je("Unable to connect wallet"));S.debug("Wallet connection successful",{wallet:q,connectorType:y.connectorType}),K("success"),F(void 0),Pe({address:j.address,client:j.walletClientType,appId:I.id}),setTimeout((()=>{e({connector:y,wallet:j})}),Qe)}catch(j){if(j?.message?.includes("already pending for origin")||j?.message?.includes("wallet_requestPermissions"))return void S.debug("Connection request already pending, maintaining loading state",{wallet:q});let Fe=j instanceof Error?j.message:String(j?.message||"Unknown error");S.error("Wallet connection failed",j,{wallet:q,connectorType:y.connectorType,errorCode:j?.privyErrorCode}),K("error"),F(j?.privyErrorCode),Z?.(j instanceof Error?j:new je(Fe||"Unable to connect wallet"))}}else S.debug("Duplicate connection attempt prevented",{wallet:q})}),[I.id,e,f,R]),qe=v.useCallback((()=>U?(K(void 0),F(void 0),V(void 0),void xe(void 0)):f?(K(void 0),F(void 0),void V(void 0)):Q?(K(void 0),F(void 0),V(void 0),void ve(void 0)):R==="error"||R==="loading"?(K(void 0),F(void 0),void V(void 0)):void B?.()),[U,f,Q,R,B]),Ie=v.useMemo((()=>f?.connector===ie&&U&&z.isMobile&&f?.name?W("connectWallet.goToWallet",{walletName:f.name}):f?.connector===ie&&U&&f?.name?W("connectWallet.scanToConnect",{walletName:f.name}):U&&f?.name?W(z.isMobile?"connectWallet.goToWallet":"connectWallet.scanToConnect",{walletName:f.name}):typeof f?.connector=="string"?W("connectWallet.openOrInstall",{walletName:f.name}):Q&&!f?W("connectWallet.selectNetwork"):f?null:W("connectWallet.selectYourWallet")),[f,U,Q,ie,W]);return{selected:Q,setSelected:ve,qrUrl:U,setQrUrl:xe,connecting:f,uiState:R,errorCode:Ke,search:ye,setSearch:Be,wallets:_,walletCount:X,wc:ie,isInitialConnectView:be,showSearchBar:Ue,title:Ie,handleConnect:Ne,handleBack:qe,onClose:Y,onConnect:e,app:le}})({...x,walletList:i,walletChainType:n}),E=b.find((e=>e.connectorType==="wallet_connect_v2")),$=b.find((e=>e.walletBranding.id==="walletconnect_solana")),we=v.useRef(null),fe=Re({count:ee.length,getScrollElement:()=>we.current,estimateSize:()=>56,overscan:6,gap:5}),te=v.useCallback((async e=>{let B=n!=="solana-only"&&e.chains?.some((c=>c.startsWith("eip155"))),Y=n!=="ethereum-only"&&e.chains?.some((c=>c.startsWith("solana"))),Z=()=>{let c=e.id;return se[c]||se[`${c}_wallet`]},J=c=>{let W=h.normalize(e.id);return b.find((_=>h.normalize(_.walletClientType)===W&&_.chainType===c&&_.connectorType!=="wallet_connect_v2"&&!(_.chainType==="ethereum"&&_ instanceof We||_.chainType==="solana"&&_ instanceof ze)))},ne=async()=>{if(!E||!e.listing)return!1;let c=H[e.listing.slug]?{...e.listing,...H[e.listing.slug]}:e.listing;return E.setWalletEntry(c,L),await E.resetConnection(e.id),await A(E,{name:e.label,icon:e.icon,id:e.id,url:e.url}),!0},le=async()=>!!$&&!!e.listing&&(await $.disconnect(),$.wallet.setWalletEntry(e.listing,L),await new Promise((c=>setTimeout(c,100))),await A($,{name:e.label,icon:e.icon,id:e.id,url:e.url}),!0),I=async c=>{let W=(_=>{let X=Z();if(X)return X.getMobileRedirect({isSolana:_,connectOnly:!!d,useUniversalLink:!1})})(c);return!!W&&(await A(W,{name:e.label,icon:e.icon,id:e.id,url:e.url}),!0)};if(B&&Y)M(e);else{if(B&&!Y){let c=J("ethereum");if(c&&!ae(c))return S.debug("Attempting injected EVM connection",{wallet:e.id,connectorType:c.connectorType}),void await A(c,{name:e.label,icon:e.icon,id:e.id,url:e.url});if(z.isMobile&&Z()){if(await I(!1)||await ne())return}else if(await ne()||await I(!1))return}if(Y&&!B){let c=J("solana");if(c&&!ae(c))return S.debug("Attempting injected Solana connection",{wallet:e.id,connectorType:c.connectorType}),void await A(c,{name:e.label,icon:e.icon,id:e.id,url:e.url});if(z.isMobile){if(await I(!0)||await le())return}else if(await le()||await I(!0))return}if(!ae(e.connector)){if(S.debug("Using fallback direct connector",{wallet:e.id,connectorType:e.connector?.connectorType}),E&&e.connector?.connectorType==="wallet_connect_v2")if(await E.resetConnection(e.id),e.id!=="wallet_connect_qr"&&e.listing){let c=H[e.listing.slug]?{...e.listing,...H[e.listing.slug]}:e.listing;E.setWalletEntry(c,L)}else E.setWalletEntry({id:"wallet_connect_qr",name:"WalletConnect",rdns:"",slug:"wallet-connect",homepage:"",chains:["eip155"],mobile:{native:"",universal:void 0}},L);return $&&e.connector?.walletBranding.id==="walletconnect_solana"&&(await $.disconnect(),e.id!=="wallet_connect_qr_solana"&&e.listing?$.wallet.setWalletEntry(e.listing,L):$.wallet.setWalletEntry({id:"wallet_connect_solana_qr",name:"WalletConnect",rdns:"",slug:"wallet-connect-solana",homepage:"",chains:["solana"],mobile:{native:"",universal:void 0}},L),await new Promise((c=>setTimeout(c,100)))),void await A(e.connector,{name:e.label,icon:e.icon,id:e.id,url:e.url})}e.url?await A(e.url,{name:e.label,icon:e.icon,id:e.id,url:e.url}):S.warn("No available connection method for wallet",{wallet:e.id})}}),[E,$,A,M,L,n,d,b]);return v.useEffect((()=>{if(!p)return;let e=ee.find((({id:B})=>B===p));e&&te(e).catch(console.error)}),[p]),t.jsxs(G,{className:g,children:[t.jsx(G.Header,{icon:r&&P?void 0:a&&!s||s&&z.isMobile&&a?.icon?a.icon:a?void 0:tt,iconVariant:a&&!s||s&&z.isMobile?"loading":void 0,iconLoadingStatus:a&&!s||s&&z.isMobile?{success:D==="success",fail:D==="error"}:void 0,title:r&&P?void 0:a&&!s?w("connectWallet.waitingForWallet",{walletName:a.name}):s&&z.isMobile?w("connectWallet.waitingForWallet",{walletName:a?.name??"connection"}):Ee,subtitle:r&&P?void 0:a&&!s&&typeof a.connector=="string"?w("connectWallet.installAndConnect",{walletName:a.name}):a&&!s&&typeof a.connector!="string"?D==="error"?_e===Ve.NO_SOLANA_ACCOUNTS?`The connected wallet has no Solana accounts. Please add a Solana account in ${a.name} and try again.`:w("connectWallet.tryConnectingAgain"):w("connectionStatus.connectOneWallet"):P?l??(T?w("connectWallet.connectToAccount",{appName:T.name}):null):null,showBack:!!u||!P,showClose:!0,onBack:u||Se,onClose:m}),t.jsxs(G.Body,{ref:we,$colorScheme:C.appearance.palette.colorScheme,style:{marginBottom:s?"0.5rem":void 0},children:[Ae&&t.jsx(st,{children:t.jsxs(et,{style:{background:"transparent"},children:[t.jsx(Ge,{children:t.jsx(lt,{})}),t.jsx("input",{className:"login-method-button",type:"text",placeholder:w("connectWallet.searchPlaceholder",{count:String(de)}),onChange:e=>Me(e.target.value),value:$e})]})}),s&&z.isMobile&&D==="loading"&&t.jsxs("div",{style:{display:"flex",flexDirection:"column",alignItems:"center",gap:"1rem"},children:[t.jsx(ke,{variant:"primary",onClick:()=>window.open(s.universal??s.native,"_blank"),style:{width:"100%"},children:w("connectWallet.openInApp")}),t.jsx(Le,{value:s.universal??s.native,iconOnly:!0,children:"Copy link"})]}),s&&!z.isMobile&&D==="loading"&&t.jsx("div",{style:{display:"flex",flexDirection:"column",alignItems:"center",gap:"1rem"},children:t.jsx(Le,{value:s.universal??s.native,iconOnly:!0,children:w("connectWallet.copyLink")})}),s&&!z.isMobile&&t.jsx(Oe,{size:280,url:s.universal??s.native,squareLogoElement:a?.icon?typeof a.icon=="string"?e=>t.jsx("svg",{...e,children:t.jsx("image",{href:a.icon,height:e.height,width:e.width})}):a.icon:He}),s&&!z.isMobile&&a?.url&&(a.id==="binance"||a.id==="binanceus"||a.id==="binance-defi")&&t.jsxs(ut,{children:[t.jsxs("span",{children:["Don't have ",a.name,"? "]}),t.jsx(Xe,{href:a.url,target:"_blank",size:"sm",children:"Download here"})]}),t.jsxs(ct,{children:[a&&!s&&typeof a.connector=="string"&&t.jsxs(oe,{onClick:()=>window.open(a.connector,"_blank"),children:[a.icon&&(typeof a.icon=="string"?t.jsx(O,{src:a.icon}):t.jsx(a.icon,{})),t.jsx(re,{children:a.name})]}),o?.chains.some((e=>e.startsWith("eip155")))&&!a&&t.jsxs(oe,{onClick:()=>te({...o,chains:o.chains.filter((e=>e.startsWith("eip155")))}),children:[o.icon&&(typeof o.icon=="string"?t.jsx(O,{src:o.icon}):t.jsx(o.icon,{})),t.jsx(re,{children:o.label}),t.jsx(ce,{children:t.jsx(me,{})})]}),o?.chains.some((e=>e.startsWith("solana")))&&!a&&t.jsxs(oe,{onClick:()=>te({...o,chains:o.chains.filter((e=>e.startsWith("solana")))}),children:[o.icon&&(typeof o.icon=="string"?t.jsx(O,{src:o.icon}):t.jsx(o.icon,{})),t.jsx(re,{children:o.label}),t.jsx(ce,{children:t.jsx(ge,{})})]}),P&&t.jsxs(t.Fragment,{children:[!(de>0)&&t.jsx(dt,{children:w("connectWallet.noWalletsFound")}),de>0&&!s&&t.jsx("div",{style:{maxHeight:56*Math.min(ee.length,5)+5,width:"100%"},children:t.jsx("div",{style:{height:`${fe.getTotalSize()}px`,width:"100%",position:"relative"},children:fe.getVirtualItems().map((e=>t.jsx(rt,{index:e.index,style:{position:"absolute",top:0,left:0,height:`${e.size}px`,transform:`translateY(${e.start}px)`},data:{wallets:ee,walletChainType:n,handleWalletClick:te}},e.key)))})})]})]})]}),t.jsxs(G.Footer,{children:[a&&!s&&typeof a.connector!="string"&&D==="error"&&t.jsx(G.Actions,{children:t.jsx(ke,{style:{width:"100%",alignItems:"center"},variant:"error",onClick:()=>A(a.connector,{name:a.name,icon:a.icon,id:a.id,url:a.url}),children:w("connectWallet.retry")})}),!!(T&&T.legal.privacyPolicyUrl&&T.legal.termsAndConditionsUrl)&&t.jsx(Ze,{app:T,alwaysShowImplicitConsent:!0}),t.jsx(G.Watermark,{})]})]})};let st=k.div`
  position: sticky;
  // Offset by negative margin to account for focus outline
  margin-top: -3px;
  padding-top: 3px;
  top: -3px;
  z-index: 1;
  background: var(--privy-color-background);
  padding-bottom: calc(var(--screen-space) / 2);
`,ct=k.div`
  display: flex;
  flex-direction: column;
  gap: ${5}px;
`,oe=k.button`
  && {
    gap: 0.5rem;
    align-items: center;
    display: flex;
    position: relative;
    text-align: left;
    font-weight: 500;
    transition: background 200ms ease-in;
    width: calc(100% - 4px);
    border-radius: var(--privy-border-radius-md);
    padding: 0.75em;
    border: 1px solid var(--privy-color-foreground-4);
    justify-content: space-between;
  }

  &:hover {
    background: var(--privy-color-background-2);
  }
`,ce=k.span`
  display: flex;
  align-items: center;
  justify-content: end;
  position: relative;

  & > svg {
    border-radius: var(--privy-border-radius-full);
    stroke-width: 2.5;
    width: 100%;
    max-height: 1rem;
    max-width: 1rem;
    flex-shrink: 0;
  }

  & > svg:not(:last-child) {
    border-radius: var(--privy-border-radius-full);
    margin-right: -0.375rem;
  }
`,dt=k.div`
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
`,re=k.span`
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--privy-color-foreground);
  font-weight: 400;
  flex: 1;
`,Le=k(Je)`
  && {
    margin: 0.5rem auto 0 auto;
  }
`,ut=k.div`
  text-align: center;
  margin-top: 1rem;
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--privy-color-foreground-3);
`;export{bt as G,h as O,ot as V,rt as Y};
