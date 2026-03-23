import{cR as a,cM as B,cN as D,cP as q,df as V,db as F,cO as r,ds as h,cT as x,dp as K,dd as z,d7 as E}from"./index-Br1bVXxn.js";import{F as X}from"./EnvelopeIcon-D8Yf2iDZ.js";import{F as Y}from"./PhoneIcon-qOA_uNfk.js";import{o as H}from"./Layouts-BlFm53ED-BFs2DcAj.js";import{n as Q}from"./Link-DJ5gq9Di-XTQsEvcQ.js";import{a as Z}from"./shouldProceedtoEmbeddedWalletCreationFlow-D2ZT5lW9-CJizlj8Y.js";import{n as G}from"./ScreenLayout-D1p_ntex-0Wt1KEE9.js";import"./ModalHeader-BnVmXtvG-DWMZi5qe.js";import"./Screen-Cycy3IzT-fkgceAT9.js";import"./index-Dq_xe9dz-D_4B3cL9.js";function J({title:o,titleId:d,...y},u){return a.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 20 20",fill:"currentColor","aria-hidden":"true","data-slot":"icon",ref:u,"aria-labelledby":d},y),o?a.createElement("title",{id:d},o):null,a.createElement("path",{fillRule:"evenodd",d:"M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z",clipRule:"evenodd"}))}const ee=a.forwardRef(J),re=({contactMethod:o,authFlow:d,appName:y="Privy",whatsAppEnabled:u=!1,onBack:k,onCodeSubmit:b,onResend:j,errorMessage:p,success:w=!1,resendCountdown:S=0,onInvalidInput:I,onClearError:N})=>{let[f,g]=a.useState(U);a.useEffect((()=>{p||g(U)}),[p]);let M=async i=>{i.preventDefault();let n=i.currentTarget.value.replace(" ","");if(n==="")return;if(isNaN(Number(n)))return void I?.("Code should be numeric");N?.();let s=Number(i.currentTarget.name?.charAt(5)),l=[...n||[""]].slice(0,P-s),m=[...f.slice(0,s),...l,...f.slice(s+l.length)];g(m);let c=Math.min(Math.max(s+l.length,0),P-1);isNaN(Number(i.currentTarget.value))||document.querySelector(`input[name=code-${c}]`)?.focus(),m.every((v=>v&&!isNaN(+v)))&&(document.querySelector(`input[name=code-${c}]`)?.blur(),await b?.(m.join("")))};return r.jsx(G,{title:"Enter confirmation code",subtitle:r.jsxs("span",d==="email"?{children:["Please check ",r.jsx(W,{children:o})," for an email from privy.io and enter your code below."]}:{children:["Please check ",r.jsx(W,{children:o})," for a",u?" WhatsApp":""," message from ",y," and enter your code below."]}),icon:d==="email"?X:Y,onBack:k,showBack:!0,helpText:r.jsxs(se,{children:[r.jsxs("span",{children:["Didn't get ",d==="email"?"an email":"a message","?"]}),S?r.jsxs(le,{children:[r.jsx(ee,{color:"var(--privy-color-foreground)",strokeWidth:1.33,height:"12px",width:"12px"}),r.jsx("span",{children:"Code sent"})]}):r.jsx(Q,{as:"button",size:"sm",onClick:j,children:"Resend code"})]}),children:r.jsx(ae,{children:r.jsx(H,{children:r.jsxs(ne,{children:[r.jsx("div",{children:f.map(((i,n)=>r.jsx("input",{name:`code-${n}`,type:"text",value:f[n],onChange:M,onKeyUp:s=>{s.key==="Backspace"&&(l=>{N?.(),g([...f.slice(0,l),"",...f.slice(l+1)]),l>0&&document.querySelector(`input[name=code-${l-1}]`)?.focus()})(n)},inputMode:"numeric",autoFocus:n===0,pattern:"[0-9]",className:`${w?"success":""} ${p?"fail":""}`,autoComplete:z.isMobile?"one-time-code":"off"},n)))}),r.jsx(ie,{$fail:!!p,$success:w,children:r.jsx("span",{children:p==="Invalid or expired verification code"?"Incorrect code":p||(w?"Success!":"")})})]})})})})};let P=6,U=Array(6).fill("");var A,T,oe=((A=oe||{})[A.RESET_AFTER_DELAY=0]="RESET_AFTER_DELAY",A[A.CLEAR_ON_NEXT_VALID_INPUT=1]="CLEAR_ON_NEXT_VALID_INPUT",A),te=((T=te||{})[T.EMAIL=0]="EMAIL",T[T.SMS=1]="SMS",T);const Ee={component:()=>{let{navigate:o,lastScreen:d,navigateBack:y,setModalData:u,onUserCloseViaDialogOrKeybindRef:k}=B(),b=D(),{closePrivyModal:j,resendEmailCode:p,resendSmsCode:w,getAuthMeta:S,loginWithCode:I,updateWallets:N,createAnalyticsEvent:f}=q(),{authenticated:g,logout:M,user:i}=V(),{whatsAppEnabled:n}=D(),[s,l]=a.useState(!1),[m,c]=a.useState(null),[v,C]=a.useState(null),[_,L]=a.useState(0);k.current=()=>null;let R=S()?.email?0:1,O=R===0?S()?.email||"":S()?.phoneNumber||"",$=F-500;return a.useEffect((()=>{if(_){let t=setTimeout((()=>{L(_-1)}),1e3);return()=>clearTimeout(t)}}),[_]),a.useEffect((()=>{if(g&&s&&i){if(b?.legal.requireUsersAcceptTerms&&!i.hasAcceptedTerms){let t=setTimeout((()=>{o("AffirmativeConsentScreen")}),$);return()=>clearTimeout(t)}if(Z(i,b.embeddedWallets)){let t=setTimeout((()=>{u({createWallet:{onSuccess:()=>{},onFailure:e=>{console.error(e),f({eventName:"embedded_wallet_creation_failure_logout",payload:{error:e,screen:"AwaitingPasswordlessCodeScreen"}}),M()},callAuthOnSuccessOnClose:!0}}),o("EmbeddedWalletOnAccountCreateScreen")}),$);return()=>clearTimeout(t)}{N();let t=setTimeout((()=>j({shouldCallAuthOnSuccess:!0,isSuccess:!0})),F);return()=>clearTimeout(t)}}}),[g,s,i]),a.useEffect((()=>{if(m&&v===0){let t=setTimeout((()=>{c(null),C(null),document.querySelector("input[name=code-0]")?.focus()}),1400);return()=>clearTimeout(t)}}),[m,v]),r.jsx(re,{contactMethod:O,authFlow:R===0?"email":"sms",appName:b?.name,whatsAppEnabled:n,onBack:()=>y(),onCodeSubmit:async t=>{try{await I(t),l(!0)}catch(e){if(e instanceof h&&e.privyErrorCode===x.INVALID_CREDENTIALS)c("Invalid or expired verification code"),C(0);else if(e instanceof h&&e.privyErrorCode===x.CANNOT_LINK_MORE_OF_TYPE)c(e.message);else{if(e instanceof h&&e.privyErrorCode===x.USER_LIMIT_REACHED)return console.error(new K(e).toString()),void o("UserLimitReachedScreen");if(e instanceof h&&e.privyErrorCode===x.USER_DOES_NOT_EXIST)return void o("AccountNotFoundScreen");if(e instanceof h&&e.privyErrorCode===x.LINKED_TO_ANOTHER_USER)return u({errorModalData:{error:e,previousScreen:d??"AwaitingPasswordlessCodeScreen"}}),void o("ErrorScreen",!1);if(e instanceof h&&e.privyErrorCode===x.DISALLOWED_PLUS_EMAIL)return u({inlineError:{error:e}}),void o("ConnectOrCreateScreen",!1);if(e instanceof h&&e.privyErrorCode===x.ACCOUNT_TRANSFER_REQUIRED&&e.data?.data?.nonce)return u({accountTransfer:{nonce:e.data?.data?.nonce,account:O,displayName:e.data?.data?.account?.displayName,linkMethod:R===0?"email":"sms",embeddedWalletAddress:e.data?.data?.otherUser?.embeddedWalletAddress}}),void o("LinkConflictScreen");c("Issue verifying code"),C(0)}}},onResend:async()=>{L(30),R===0?await p():await w()},errorMessage:m||void 0,success:s,resendCountdown:_,onInvalidInput:t=>{c(t),C(1)},onClearError:()=>{v===1&&(c(null),C(null))}})}};let ae=E.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: auto;
  gap: 16px;
  flex-grow: 1;
  width: 100%;
`,ne=E.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 12px;

  > div:first-child {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    border-radius: var(--privy-border-radius-sm);

    > input {
      border: 1px solid var(--privy-color-foreground-4);
      background: var(--privy-color-background);
      border-radius: var(--privy-border-radius-sm);
      padding: 8px 10px;
      height: 48px;
      width: 40px;
      text-align: center;
      font-size: 18px;
      font-weight: 600;
      color: var(--privy-color-foreground);
      transition: all 0.2s ease;
    }

    > input:focus {
      border: 1px solid var(--privy-color-foreground);
      box-shadow: 0 0 0 1px var(--privy-color-foreground);
    }

    > input:invalid {
      border: 1px solid var(--privy-color-error);
    }

    > input.success {
      border: 1px solid var(--privy-color-border-success);
      background: var(--privy-color-success-bg);
    }

    > input.fail {
      border: 1px solid var(--privy-color-border-error);
      background: var(--privy-color-error-bg);
      animation: shake 180ms;
      animation-iteration-count: 2;
    }
  }

  @keyframes shake {
    0% {
      transform: translate(1px, 0px);
    }
    33% {
      transform: translate(-1px, 0px);
    }
    67% {
      transform: translate(-1px, 0px);
    }
    100% {
      transform: translate(1px, 0px);
    }
  }
`,ie=E.div`
  line-height: 20px;
  min-height: 20px;
  font-size: 14px;
  font-weight: 400;
  color: ${o=>o.$success?"var(--privy-color-success-dark)":o.$fail?"var(--privy-color-error-dark)":"transparent"};
  display: flex;
  justify-content: center;
  width: 100%;
  text-align: center;
`,se=E.div`
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: var(--privy-color-foreground-2);
`,le=E.div`
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--privy-border-radius-sm);
  padding: 2px 8px;
  gap: 4px;
  background: var(--privy-color-background-2);
  color: var(--privy-color-foreground-2);
`,W=E.span`
  font-weight: 500;
  word-break: break-all;
  color: var(--privy-color-foreground);
`;export{Ee as AwaitingPasswordlessCodeScreen,re as AwaitingPasswordlessCodeScreenView,Ee as default};
