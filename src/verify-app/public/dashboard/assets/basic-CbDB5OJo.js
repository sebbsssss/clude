import{i as N,e as G,r as q,a as O,b as c,C as M,A as z,O as ee,c as j,E as te,R as U,d as Me,f as K,g as k,S as ft,h as yi,W as pt,j as Xt,k as vn,T as Zt,l as Xe,M as ni,m as ii,w as Ne,n as yn,o as xi}from"./core-1_zToePH.js";import{n as u,c as T,o as W,r as I,U as he,e as Ci,f as Ri,a as $i}from"./index-Ck25j5Sd.js";import{bq as Ii,o as Ei}from"./index-Bzf0Y-RO.js";const Wi=N`
  :host {
    position: relative;
    background-color: var(--wui-color-gray-glass-002);
    display: flex;
    justify-content: center;
    align-items: center;
    width: var(--local-size);
    height: var(--local-size);
    border-radius: inherit;
    border-radius: var(--local-border-radius);
  }

  :host > wui-flex {
    overflow: hidden;
    border-radius: inherit;
    border-radius: var(--local-border-radius);
  }

  :host::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: inherit;
    border: 1px solid var(--wui-color-gray-glass-010);
    pointer-events: none;
  }

  :host([name='Extension'])::after {
    border: 1px solid var(--wui-color-accent-glass-010);
  }

  :host([data-wallet-icon='allWallets']) {
    background-color: var(--wui-all-wallets-bg-100);
  }

  :host([data-wallet-icon='allWallets'])::after {
    border: 1px solid var(--wui-color-accent-glass-010);
  }

  wui-icon[data-parent-size='inherit'] {
    width: 75%;
    height: 75%;
    align-items: center;
  }

  wui-icon[data-parent-size='sm'] {
    width: 18px;
    height: 18px;
  }

  wui-icon[data-parent-size='md'] {
    width: 24px;
    height: 24px;
  }

  wui-icon[data-parent-size='lg'] {
    width: 42px;
    height: 42px;
  }

  wui-icon[data-parent-size='full'] {
    width: 100%;
    height: 100%;
  }

  :host > wui-icon-box {
    position: absolute;
    overflow: hidden;
    right: -1px;
    bottom: -2px;
    z-index: 1;
    border: 2px solid var(--wui-color-bg-150, #1e1f1f);
    padding: 1px;
  }
`;var Ie=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let fe=class extends O{constructor(){super(...arguments),this.size="md",this.name="",this.installed=!1,this.badgeSize="xs"}render(){let e="xxs";return this.size==="lg"?e="m":this.size==="md"?e="xs":e="xxs",this.style.cssText=`
       --local-border-radius: var(--wui-border-radius-${e});
       --local-size: var(--wui-wallet-image-size-${this.size});
   `,this.walletIcon&&(this.dataset.walletIcon=this.walletIcon),c`
      <wui-flex justifyContent="center" alignItems="center"> ${this.templateVisual()} </wui-flex>
    `}templateVisual(){return this.imageSrc?c`<wui-image src=${this.imageSrc} alt=${this.name}></wui-image>`:this.walletIcon?c`<wui-icon
        data-parent-size="md"
        size="md"
        color="inherit"
        name=${this.walletIcon}
      ></wui-icon>`:c`<wui-icon
      data-parent-size=${this.size}
      size="inherit"
      color="inherit"
      name="walletPlaceholder"
    ></wui-icon>`}};fe.styles=[G,q,Wi];Ie([u()],fe.prototype,"size",void 0);Ie([u()],fe.prototype,"name",void 0);Ie([u()],fe.prototype,"imageSrc",void 0);Ie([u()],fe.prototype,"walletIcon",void 0);Ie([u({type:Boolean})],fe.prototype,"installed",void 0);Ie([u()],fe.prototype,"badgeSize",void 0);fe=Ie([T("wui-wallet-image")],fe);const _i=N`
  :host {
    position: relative;
    border-radius: var(--wui-border-radius-xxs);
    width: 40px;
    height: 40px;
    overflow: hidden;
    background: var(--wui-color-gray-glass-002);
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--wui-spacing-4xs);
    padding: 3.75px !important;
  }

  :host::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: inherit;
    border: 1px solid var(--wui-color-gray-glass-010);
    pointer-events: none;
  }

  :host > wui-wallet-image {
    width: 14px;
    height: 14px;
    border-radius: var(--wui-border-radius-5xs);
  }

  :host > wui-flex {
    padding: 2px;
    position: fixed;
    overflow: hidden;
    left: 34px;
    bottom: 8px;
    background: var(--dark-background-150, #1e1f1f);
    border-radius: 50%;
    z-index: 2;
    display: flex;
  }
`;var oi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};const Et=4;let Ze=class extends O{constructor(){super(...arguments),this.walletImages=[]}render(){const e=this.walletImages.length<Et;return c`${this.walletImages.slice(0,Et).map(({src:n,walletName:i})=>c`
            <wui-wallet-image
              size="inherit"
              imageSrc=${n}
              name=${W(i)}
            ></wui-wallet-image>
          `)}
      ${e?[...Array(Et-this.walletImages.length)].map(()=>c` <wui-wallet-image size="inherit" name=""></wui-wallet-image>`):null}
      <wui-flex>
        <wui-icon-box
          size="xxs"
          iconSize="xxs"
          iconcolor="success-100"
          backgroundcolor="success-100"
          icon="checkmark"
          background="opaque"
        ></wui-icon-box>
      </wui-flex>`}};Ze.styles=[q,_i];oi([u({type:Array})],Ze.prototype,"walletImages",void 0);Ze=oi([T("wui-all-wallets-image")],Ze);const Si=N`
  button {
    column-gap: var(--wui-spacing-s);
    padding: 7px var(--wui-spacing-l) 7px var(--wui-spacing-xs);
    width: 100%;
    background-color: var(--wui-color-gray-glass-002);
    border-radius: var(--wui-border-radius-xs);
    color: var(--wui-color-fg-100);
  }

  button > wui-text:nth-child(2) {
    display: flex;
    flex: 1;
  }

  button:disabled {
    background-color: var(--wui-color-gray-glass-015);
    color: var(--wui-color-gray-glass-015);
  }

  button:disabled > wui-tag {
    background-color: var(--wui-color-gray-glass-010);
    color: var(--wui-color-fg-300);
  }

  wui-icon {
    color: var(--wui-color-fg-200) !important;
  }
`;var Y=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let F=class extends O{constructor(){super(...arguments),this.walletImages=[],this.imageSrc="",this.name="",this.tabIdx=void 0,this.installed=!1,this.disabled=!1,this.showAllWallets=!1,this.loading=!1,this.loadingSpinnerColor="accent-100"}render(){return c`
      <button ?disabled=${this.disabled} tabindex=${W(this.tabIdx)}>
        ${this.templateAllWallets()} ${this.templateWalletImage()}
        <wui-text variant="paragraph-500" color="inherit">${this.name}</wui-text>
        ${this.templateStatus()}
      </button>
    `}templateAllWallets(){return this.showAllWallets&&this.imageSrc?c` <wui-all-wallets-image .imageeSrc=${this.imageSrc}> </wui-all-wallets-image> `:this.showAllWallets&&this.walletIcon?c` <wui-wallet-image .walletIcon=${this.walletIcon} size="sm"> </wui-wallet-image> `:null}templateWalletImage(){return!this.showAllWallets&&this.imageSrc?c`<wui-wallet-image
        size="sm"
        imageSrc=${this.imageSrc}
        name=${this.name}
        .installed=${this.installed}
      ></wui-wallet-image>`:!this.showAllWallets&&!this.imageSrc?c`<wui-wallet-image size="sm" name=${this.name}></wui-wallet-image>`:null}templateStatus(){return this.loading?c`<wui-loading-spinner
        size="lg"
        color=${this.loadingSpinnerColor}
      ></wui-loading-spinner>`:this.tagLabel&&this.tagVariant?c`<wui-tag variant=${this.tagVariant}>${this.tagLabel}</wui-tag>`:this.icon?c`<wui-icon color="inherit" size="sm" name=${this.icon}></wui-icon>`:null}};F.styles=[q,G,Si];Y([u({type:Array})],F.prototype,"walletImages",void 0);Y([u()],F.prototype,"imageSrc",void 0);Y([u()],F.prototype,"name",void 0);Y([u()],F.prototype,"tagLabel",void 0);Y([u()],F.prototype,"tagVariant",void 0);Y([u()],F.prototype,"icon",void 0);Y([u()],F.prototype,"walletIcon",void 0);Y([u()],F.prototype,"tabIdx",void 0);Y([u({type:Boolean})],F.prototype,"installed",void 0);Y([u({type:Boolean})],F.prototype,"disabled",void 0);Y([u({type:Boolean})],F.prototype,"showAllWallets",void 0);Y([u({type:Boolean})],F.prototype,"loading",void 0);Y([u({type:String})],F.prototype,"loadingSpinnerColor",void 0);F=Y([T("wui-list-wallet")],F);var Ae=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let ye=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.count=z.state.count,this.filteredCount=z.state.filteredWallets.length,this.isFetchingRecommendedWallets=z.state.isFetchingRecommendedWallets,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e),z.subscribeKey("count",e=>this.count=e),z.subscribeKey("filteredWallets",e=>this.filteredCount=e.length),z.subscribeKey("isFetchingRecommendedWallets",e=>this.isFetchingRecommendedWallets=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){const e=this.connectors.find(l=>l.id==="walletConnect"),{allWallets:n}=ee.state;if(!e||n==="HIDE"||n==="ONLY_MOBILE"&&!j.isMobile())return null;const i=z.state.featured.length,o=this.count+i,t=o<10?o:Math.floor(o/10)*10,a=this.filteredCount>0?this.filteredCount:t;let s=`${a}`;return this.filteredCount>0?s=`${this.filteredCount}`:a<o&&(s=`${a}+`),c`
      <wui-list-wallet
        name="All Wallets"
        walletIcon="allWallets"
        showAllWallets
        @click=${this.onAllWallets.bind(this)}
        tagLabel=${s}
        tagVariant="shade"
        data-testid="all-wallets"
        tabIdx=${W(this.tabIdx)}
        .loading=${this.isFetchingRecommendedWallets}
        loadingSpinnerColor=${this.isFetchingRecommendedWallets?"fg-300":"accent-100"}
      ></wui-list-wallet>
    `}onAllWallets(){te.sendEvent({type:"track",event:"CLICK_ALL_WALLETS"}),U.push("AllWallets")}};Ae([u()],ye.prototype,"tabIdx",void 0);Ae([I()],ye.prototype,"connectors",void 0);Ae([I()],ye.prototype,"count",void 0);Ae([I()],ye.prototype,"filteredCount",void 0);Ae([I()],ye.prototype,"isFetchingRecommendedWallets",void 0);ye=Ae([T("w3m-all-wallets-widget")],ye);var an=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let et=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){const e=this.connectors.filter(n=>n.type==="ANNOUNCED");return e?.length?c`
      <wui-flex flexDirection="column" gap="xs">
        ${e.filter(Me.showConnector).map(n=>c`
              <wui-list-wallet
                imageSrc=${W(K.getConnectorImage(n))}
                name=${n.name??"Unknown"}
                @click=${()=>this.onConnector(n)}
                tagVariant="success"
                tagLabel="installed"
                data-testid=${`wallet-selector-${n.id}`}
                .installed=${!0}
                tabIdx=${W(this.tabIdx)}
              >
              </wui-list-wallet>
            `)}
      </wui-flex>
    `:(this.style.cssText="display: none",null)}onConnector(e){e.id==="walletConnect"?j.isMobile()?U.push("AllWallets"):U.push("ConnectingWalletConnect"):U.push("ConnectingExternal",{connector:e})}};an([u()],et.prototype,"tabIdx",void 0);an([I()],et.prototype,"connectors",void 0);et=an([T("w3m-connect-announced-widget")],et);var gt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Ue=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.loading=!1,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e)),j.isTelegram()&&j.isIos()&&(this.loading=!k.state.wcUri,this.unsubscribe.push(k.subscribeKey("wcUri",e=>this.loading=!e)))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){const{customWallets:e}=ee.state;if(!e?.length)return this.style.cssText="display: none",null;const n=this.filterOutDuplicateWallets(e);return c`<wui-flex flexDirection="column" gap="xs">
      ${n.map(i=>c`
          <wui-list-wallet
            imageSrc=${W(K.getWalletImage(i))}
            name=${i.name??"Unknown"}
            @click=${()=>this.onConnectWallet(i)}
            data-testid=${`wallet-selector-${i.id}`}
            tabIdx=${W(this.tabIdx)}
            ?loading=${this.loading}
          >
          </wui-list-wallet>
        `)}
    </wui-flex>`}filterOutDuplicateWallets(e){const n=ft.getRecentWallets(),i=this.connectors.map(s=>s.info?.rdns).filter(Boolean),o=n.map(s=>s.rdns).filter(Boolean),t=i.concat(o);if(t.includes("io.metamask.mobile")&&j.isMobile()){const s=t.indexOf("io.metamask.mobile");t[s]="io.metamask"}return e.filter(s=>!t.includes(String(s?.rdns)))}onConnectWallet(e){this.loading||U.push("ConnectingWalletConnect",{wallet:e})}};gt([u()],Ue.prototype,"tabIdx",void 0);gt([I()],Ue.prototype,"connectors",void 0);gt([I()],Ue.prototype,"loading",void 0);Ue=gt([T("w3m-connect-custom-widget")],Ue);var sn=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let tt=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){const i=this.connectors.filter(o=>o.type==="EXTERNAL").filter(Me.showConnector).filter(o=>o.id!==yi.CONNECTOR_ID.COINBASE_SDK);return i?.length?c`
      <wui-flex flexDirection="column" gap="xs">
        ${i.map(o=>c`
            <wui-list-wallet
              imageSrc=${W(K.getConnectorImage(o))}
              .installed=${!0}
              name=${o.name??"Unknown"}
              data-testid=${`wallet-selector-external-${o.id}`}
              @click=${()=>this.onConnector(o)}
              tabIdx=${W(this.tabIdx)}
            >
            </wui-list-wallet>
          `)}
      </wui-flex>
    `:(this.style.cssText="display: none",null)}onConnector(e){U.push("ConnectingExternal",{connector:e})}};sn([u()],tt.prototype,"tabIdx",void 0);sn([I()],tt.prototype,"connectors",void 0);tt=sn([T("w3m-connect-external-widget")],tt);var ln=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let nt=class extends O{constructor(){super(...arguments),this.tabIdx=void 0,this.wallets=[]}render(){return this.wallets.length?c`
      <wui-flex flexDirection="column" gap="xs">
        ${this.wallets.map(e=>c`
            <wui-list-wallet
              data-testid=${`wallet-selector-featured-${e.id}`}
              imageSrc=${W(K.getWalletImage(e))}
              name=${e.name??"Unknown"}
              @click=${()=>this.onConnectWallet(e)}
              tabIdx=${W(this.tabIdx)}
            >
            </wui-list-wallet>
          `)}
      </wui-flex>
    `:(this.style.cssText="display: none",null)}onConnectWallet(e){M.selectWalletConnector(e)}};ln([u()],nt.prototype,"tabIdx",void 0);ln([u()],nt.prototype,"wallets",void 0);nt=ln([T("w3m-connect-featured-widget")],nt);var cn=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let it=class extends O{constructor(){super(...arguments),this.tabIdx=void 0,this.connectors=[]}render(){const e=this.connectors.filter(Me.showConnector);return e.length===0?(this.style.cssText="display: none",null):c`
      <wui-flex flexDirection="column" gap="xs">
        ${e.map(n=>c`
            <wui-list-wallet
              imageSrc=${W(K.getConnectorImage(n))}
              .installed=${!0}
              name=${n.name??"Unknown"}
              tagVariant="success"
              tagLabel="installed"
              data-testid=${`wallet-selector-${n.id}`}
              @click=${()=>this.onConnector(n)}
              tabIdx=${W(this.tabIdx)}
            >
            </wui-list-wallet>
          `)}
      </wui-flex>
    `}onConnector(e){M.setActiveConnector(e),U.push("ConnectingExternal",{connector:e})}};cn([u()],it.prototype,"tabIdx",void 0);cn([u()],it.prototype,"connectors",void 0);it=cn([T("w3m-connect-injected-widget")],it);var un=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let ot=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){const e=this.connectors.filter(n=>n.type==="MULTI_CHAIN"&&n.name!=="WalletConnect");return e?.length?c`
      <wui-flex flexDirection="column" gap="xs">
        ${e.map(n=>c`
            <wui-list-wallet
              imageSrc=${W(K.getConnectorImage(n))}
              .installed=${!0}
              name=${n.name??"Unknown"}
              tagVariant="shade"
              tagLabel="multichain"
              data-testid=${`wallet-selector-${n.id}`}
              @click=${()=>this.onConnector(n)}
              tabIdx=${W(this.tabIdx)}
            >
            </wui-list-wallet>
          `)}
      </wui-flex>
    `:(this.style.cssText="display: none",null)}onConnector(e){M.setActiveConnector(e),U.push("ConnectingMultiChain")}};un([u()],ot.prototype,"tabIdx",void 0);un([I()],ot.prototype,"connectors",void 0);ot=un([T("w3m-connect-multi-chain-widget")],ot);var wt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let qe=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.loading=!1,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e)),j.isTelegram()&&j.isIos()&&(this.loading=!k.state.wcUri,this.unsubscribe.push(k.subscribeKey("wcUri",e=>this.loading=!e)))}render(){const n=ft.getRecentWallets().filter(i=>!pt.isExcluded(i)).filter(i=>!this.hasWalletConnector(i)).filter(i=>this.isWalletCompatibleWithCurrentChain(i));return n.length?c`
      <wui-flex flexDirection="column" gap="xs">
        ${n.map(i=>c`
            <wui-list-wallet
              imageSrc=${W(K.getWalletImage(i))}
              name=${i.name??"Unknown"}
              @click=${()=>this.onConnectWallet(i)}
              tagLabel="recent"
              tagVariant="shade"
              tabIdx=${W(this.tabIdx)}
              ?loading=${this.loading}
            >
            </wui-list-wallet>
          `)}
      </wui-flex>
    `:(this.style.cssText="display: none",null)}onConnectWallet(e){this.loading||M.selectWalletConnector(e)}hasWalletConnector(e){return this.connectors.some(n=>n.id===e.id||n.name===e.name)}isWalletCompatibleWithCurrentChain(e){const n=Xt.state.activeChain;return n&&e.chains?e.chains.some(i=>{const o=i.split(":")[0];return n===o}):!0}};wt([u()],qe.prototype,"tabIdx",void 0);wt([I()],qe.prototype,"connectors",void 0);wt([I()],qe.prototype,"loading",void 0);qe=wt([T("w3m-connect-recent-widget")],qe);var bt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Fe=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.wallets=[],this.loading=!1,j.isTelegram()&&j.isIos()&&(this.loading=!k.state.wcUri,this.unsubscribe.push(k.subscribeKey("wcUri",e=>this.loading=!e)))}render(){const{connectors:e}=M.state,{customWallets:n,featuredWalletIds:i}=ee.state,o=ft.getRecentWallets(),t=e.find(w=>w.id==="walletConnect"),s=e.filter(w=>w.type==="INJECTED"||w.type==="ANNOUNCED"||w.type==="MULTI_CHAIN").filter(w=>w.name!=="Browser Wallet");if(!t)return null;if(i||n||!this.wallets.length)return this.style.cssText="display: none",null;const l=s.length+o.length,d=Math.max(0,2-l),p=pt.filterOutDuplicateWallets(this.wallets).slice(0,d);return p.length?c`
      <wui-flex flexDirection="column" gap="xs">
        ${p.map(w=>c`
            <wui-list-wallet
              imageSrc=${W(K.getWalletImage(w))}
              name=${w?.name??"Unknown"}
              @click=${()=>this.onConnectWallet(w)}
              tabIdx=${W(this.tabIdx)}
              ?loading=${this.loading}
            >
            </wui-list-wallet>
          `)}
      </wui-flex>
    `:(this.style.cssText="display: none",null)}onConnectWallet(e){if(this.loading)return;const n=M.getConnector(e.id,e.rdns);n?U.push("ConnectingExternal",{connector:n}):U.push("ConnectingWalletConnect",{wallet:e})}};bt([u()],Fe.prototype,"tabIdx",void 0);bt([u()],Fe.prototype,"wallets",void 0);bt([I()],Fe.prototype,"loading",void 0);Fe=bt([T("w3m-connect-recommended-widget")],Fe);var mt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Ve=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.connectorImages=vn.state.connectorImages,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e),vn.subscribeKey("connectorImages",e=>this.connectorImages=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){if(j.isMobile())return this.style.cssText="display: none",null;const e=this.connectors.find(i=>i.id==="walletConnect");if(!e)return this.style.cssText="display: none",null;const n=e.imageUrl||this.connectorImages[e?.imageId??""];return c`
      <wui-list-wallet
        imageSrc=${W(n)}
        name=${e.name??"Unknown"}
        @click=${()=>this.onConnector(e)}
        tagLabel="qr code"
        tagVariant="main"
        tabIdx=${W(this.tabIdx)}
        data-testid="wallet-selector-walletconnect"
      >
      </wui-list-wallet>
    `}onConnector(e){M.setActiveConnector(e),U.push("ConnectingWalletConnect")}};mt([u()],Ve.prototype,"tabIdx",void 0);mt([I()],Ve.prototype,"connectors",void 0);mt([I()],Ve.prototype,"connectorImages",void 0);Ve=mt([T("w3m-connect-walletconnect-widget")],Ve);const Ti=N`
  :host {
    margin-top: var(--wui-spacing-3xs);
  }
  wui-separator {
    margin: var(--wui-spacing-m) calc(var(--wui-spacing-m) * -1) var(--wui-spacing-xs)
      calc(var(--wui-spacing-m) * -1);
    width: calc(100% + var(--wui-spacing-s) * 2);
  }
`;var Ke=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let xe=class extends O{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=M.state.connectors,this.recommended=z.state.recommended,this.featured=z.state.featured,this.unsubscribe.push(M.subscribeKey("connectors",e=>this.connectors=e),z.subscribeKey("recommended",e=>this.recommended=e),z.subscribeKey("featured",e=>this.featured=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return c`
      <wui-flex flexDirection="column" gap="xs"> ${this.connectorListTemplate()} </wui-flex>
    `}connectorListTemplate(){const{custom:e,recent:n,announced:i,injected:o,multiChain:t,recommended:a,featured:s,external:l}=Me.getConnectorsByType(this.connectors,this.recommended,this.featured);return Me.getConnectorTypeOrder({custom:e,recent:n,announced:i,injected:o,multiChain:t,recommended:a,featured:s,external:l}).map(p=>{switch(p){case"injected":return c`
            ${t.length?c`<w3m-connect-multi-chain-widget
                  tabIdx=${W(this.tabIdx)}
                ></w3m-connect-multi-chain-widget>`:null}
            ${i.length?c`<w3m-connect-announced-widget
                  tabIdx=${W(this.tabIdx)}
                ></w3m-connect-announced-widget>`:null}
            ${o.length?c`<w3m-connect-injected-widget
                  .connectors=${o}
                  tabIdx=${W(this.tabIdx)}
                ></w3m-connect-injected-widget>`:null}
          `;case"walletConnect":return c`<w3m-connect-walletconnect-widget
            tabIdx=${W(this.tabIdx)}
          ></w3m-connect-walletconnect-widget>`;case"recent":return c`<w3m-connect-recent-widget
            tabIdx=${W(this.tabIdx)}
          ></w3m-connect-recent-widget>`;case"featured":return c`<w3m-connect-featured-widget
            .wallets=${s}
            tabIdx=${W(this.tabIdx)}
          ></w3m-connect-featured-widget>`;case"custom":return c`<w3m-connect-custom-widget
            tabIdx=${W(this.tabIdx)}
          ></w3m-connect-custom-widget>`;case"external":return c`<w3m-connect-external-widget
            tabIdx=${W(this.tabIdx)}
          ></w3m-connect-external-widget>`;case"recommended":return c`<w3m-connect-recommended-widget
            .wallets=${a}
            tabIdx=${W(this.tabIdx)}
          ></w3m-connect-recommended-widget>`;default:return console.warn(`Unknown connector type: ${p}`),null}})}};xe.styles=Ti;Ke([u()],xe.prototype,"tabIdx",void 0);Ke([I()],xe.prototype,"connectors",void 0);Ke([I()],xe.prototype,"recommended",void 0);Ke([I()],xe.prototype,"featured",void 0);xe=Ke([T("w3m-connector-list")],xe);const Bi=N`
  :host {
    display: inline-flex;
    background-color: var(--wui-color-gray-glass-002);
    border-radius: var(--wui-border-radius-3xl);
    padding: var(--wui-spacing-3xs);
    position: relative;
    height: 36px;
    min-height: 36px;
    overflow: hidden;
  }

  :host::before {
    content: '';
    position: absolute;
    pointer-events: none;
    top: 4px;
    left: 4px;
    display: block;
    width: var(--local-tab-width);
    height: 28px;
    border-radius: var(--wui-border-radius-3xl);
    background-color: var(--wui-color-gray-glass-002);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-002);
    transform: translateX(calc(var(--local-tab) * var(--local-tab-width)));
    transition: transform var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: background-color, opacity;
  }

  :host([data-type='flex'])::before {
    left: 3px;
    transform: translateX(calc((var(--local-tab) * 34px) + (var(--local-tab) * 4px)));
  }

  :host([data-type='flex']) {
    display: flex;
    padding: 0px 0px 0px 12px;
    gap: 4px;
  }

  :host([data-type='flex']) > button > wui-text {
    position: absolute;
    left: 18px;
    opacity: 0;
  }

  button[data-active='true'] > wui-icon,
  button[data-active='true'] > wui-text {
    color: var(--wui-color-fg-100);
  }

  button[data-active='false'] > wui-icon,
  button[data-active='false'] > wui-text {
    color: var(--wui-color-fg-200);
  }

  button[data-active='true']:disabled,
  button[data-active='false']:disabled {
    background-color: transparent;
    opacity: 0.5;
    cursor: not-allowed;
  }

  button[data-active='true']:disabled > wui-text {
    color: var(--wui-color-fg-200);
  }

  button[data-active='false']:disabled > wui-text {
    color: var(--wui-color-fg-300);
  }

  button > wui-icon,
  button > wui-text {
    pointer-events: none;
    transition: color var(--wui-e ase-out-power-1) var(--wui-duration-md);
    will-change: color;
  }

  button {
    width: var(--local-tab-width);
    transition: background-color var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: background-color;
  }

  :host([data-type='flex']) > button {
    width: 34px;
    position: relative;
    display: flex;
    justify-content: flex-start;
  }

  button:hover:enabled,
  button:active:enabled {
    background-color: transparent !important;
  }

  button:hover:enabled > wui-icon,
  button:active:enabled > wui-icon {
    transition: all var(--wui-ease-out-power-1) var(--wui-duration-lg);
    color: var(--wui-color-fg-125);
  }

  button:hover:enabled > wui-text,
  button:active:enabled > wui-text {
    transition: all var(--wui-ease-out-power-1) var(--wui-duration-lg);
    color: var(--wui-color-fg-125);
  }

  button {
    border-radius: var(--wui-border-radius-3xl);
  }
`;var ve=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let re=class extends O{constructor(){super(...arguments),this.tabs=[],this.onTabChange=()=>null,this.buttons=[],this.disabled=!1,this.localTabWidth="100px",this.activeTab=0,this.isDense=!1}render(){return this.isDense=this.tabs.length>3,this.style.cssText=`
      --local-tab: ${this.activeTab};
      --local-tab-width: ${this.localTabWidth};
    `,this.dataset.type=this.isDense?"flex":"block",this.tabs.map((e,n)=>{const i=n===this.activeTab;return c`
        <button
          ?disabled=${this.disabled}
          @click=${()=>this.onTabClick(n)}
          data-active=${i}
          data-testid="tab-${e.label?.toLowerCase()}"
        >
          ${this.iconTemplate(e)}
          <wui-text variant="small-600" color="inherit"> ${e.label} </wui-text>
        </button>
      `})}firstUpdated(){this.shadowRoot&&this.isDense&&(this.buttons=[...this.shadowRoot.querySelectorAll("button")],setTimeout(()=>{this.animateTabs(0,!0)},0))}iconTemplate(e){return e.icon?c`<wui-icon size="xs" color="inherit" name=${e.icon}></wui-icon>`:null}onTabClick(e){this.buttons&&this.animateTabs(e,!1),this.activeTab=e,this.onTabChange(e)}animateTabs(e,n){const i=this.buttons[this.activeTab],o=this.buttons[e],t=i?.querySelector("wui-text"),a=o?.querySelector("wui-text"),s=o?.getBoundingClientRect(),l=a?.getBoundingClientRect();i&&t&&!n&&e!==this.activeTab&&(t.animate([{opacity:0}],{duration:50,easing:"ease",fill:"forwards"}),i.animate([{width:"34px"}],{duration:500,easing:"ease",fill:"forwards"})),o&&s&&l&&a&&(e!==this.activeTab||n)&&(this.localTabWidth=`${Math.round(s.width+l.width)+6}px`,o.animate([{width:`${s.width+l.width}px`}],{duration:n?0:500,fill:"forwards",easing:"ease"}),a.animate([{opacity:1}],{duration:n?0:125,delay:n?0:200,fill:"forwards",easing:"ease"}))}};re.styles=[q,G,Bi];ve([u({type:Array})],re.prototype,"tabs",void 0);ve([u()],re.prototype,"onTabChange",void 0);ve([u({type:Array})],re.prototype,"buttons",void 0);ve([u({type:Boolean})],re.prototype,"disabled",void 0);ve([u()],re.prototype,"localTabWidth",void 0);ve([I()],re.prototype,"activeTab",void 0);ve([I()],re.prototype,"isDense",void 0);re=ve([T("wui-tabs")],re);var dn=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let rt=class extends O{constructor(){super(...arguments),this.platformTabs=[],this.unsubscribe=[],this.platforms=[],this.onSelectPlatfrom=void 0}disconnectCallback(){this.unsubscribe.forEach(e=>e())}render(){const e=this.generateTabs();return c`
      <wui-flex justifyContent="center" .padding=${["0","0","l","0"]}>
        <wui-tabs .tabs=${e} .onTabChange=${this.onTabChange.bind(this)}></wui-tabs>
      </wui-flex>
    `}generateTabs(){const e=this.platforms.map(n=>n==="browser"?{label:"Browser",icon:"extension",platform:"browser"}:n==="mobile"?{label:"Mobile",icon:"mobile",platform:"mobile"}:n==="qrcode"?{label:"Mobile",icon:"mobile",platform:"qrcode"}:n==="web"?{label:"Webapp",icon:"browser",platform:"web"}:n==="desktop"?{label:"Desktop",icon:"desktop",platform:"desktop"}:{label:"Browser",icon:"extension",platform:"unsupported"});return this.platformTabs=e.map(({platform:n})=>n),e}onTabChange(e){const n=this.platformTabs[e];n&&this.onSelectPlatfrom?.(n)}};dn([u({type:Array})],rt.prototype,"platforms",void 0);dn([u()],rt.prototype,"onSelectPlatfrom",void 0);rt=dn([T("w3m-connecting-header")],rt);const Pi=N`
  :host {
    width: var(--local-width);
    position: relative;
  }

  button {
    border: none;
    border-radius: var(--local-border-radius);
    width: var(--local-width);
    white-space: nowrap;
  }

  /* -- Sizes --------------------------------------------------- */
  button[data-size='md'] {
    padding: 8.2px var(--wui-spacing-l) 9px var(--wui-spacing-l);
    height: 36px;
  }

  button[data-size='md'][data-icon-left='true'][data-icon-right='false'] {
    padding: 8.2px var(--wui-spacing-l) 9px var(--wui-spacing-s);
  }

  button[data-size='md'][data-icon-right='true'][data-icon-left='false'] {
    padding: 8.2px var(--wui-spacing-s) 9px var(--wui-spacing-l);
  }

  button[data-size='lg'] {
    padding: var(--wui-spacing-m) var(--wui-spacing-2l);
    height: 48px;
  }

  /* -- Variants --------------------------------------------------------- */
  button[data-variant='main'] {
    background-color: var(--wui-color-accent-100);
    color: var(--wui-color-inverse-100);
    border: none;
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-010);
  }

  button[data-variant='inverse'] {
    background-color: var(--wui-color-inverse-100);
    color: var(--wui-color-inverse-000);
    border: none;
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-010);
  }

  button[data-variant='accent'] {
    background-color: var(--wui-color-accent-glass-010);
    color: var(--wui-color-accent-100);
    border: none;
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-005);
  }

  button[data-variant='accent-error'] {
    background: var(--wui-color-error-glass-015);
    color: var(--wui-color-error-100);
    border: none;
    box-shadow: inset 0 0 0 1px var(--wui-color-error-glass-010);
  }

  button[data-variant='accent-success'] {
    background: var(--wui-color-success-glass-015);
    color: var(--wui-color-success-100);
    border: none;
    box-shadow: inset 0 0 0 1px var(--wui-color-success-glass-010);
  }

  button[data-variant='neutral'] {
    background: transparent;
    color: var(--wui-color-fg-100);
    border: none;
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-005);
  }

  /* -- Focus states --------------------------------------------------- */
  button[data-variant='main']:focus-visible:enabled {
    background-color: var(--wui-color-accent-090);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0 0 0 4px var(--wui-color-accent-glass-020);
  }
  button[data-variant='inverse']:focus-visible:enabled {
    background-color: var(--wui-color-inverse-100);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-gray-glass-010),
      0 0 0 4px var(--wui-color-accent-glass-020);
  }
  button[data-variant='accent']:focus-visible:enabled {
    background-color: var(--wui-color-accent-glass-010);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0 0 0 4px var(--wui-color-accent-glass-020);
  }
  button[data-variant='accent-error']:focus-visible:enabled {
    background: var(--wui-color-error-glass-015);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-error-100),
      0 0 0 4px var(--wui-color-error-glass-020);
  }
  button[data-variant='accent-success']:focus-visible:enabled {
    background: var(--wui-color-success-glass-015);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-success-100),
      0 0 0 4px var(--wui-color-success-glass-020);
  }
  button[data-variant='neutral']:focus-visible:enabled {
    background: var(--wui-color-gray-glass-005);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-gray-glass-010),
      0 0 0 4px var(--wui-color-gray-glass-002);
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  @media (hover: hover) and (pointer: fine) {
    button[data-variant='main']:hover:enabled {
      background-color: var(--wui-color-accent-090);
    }

    button[data-variant='main']:active:enabled {
      background-color: var(--wui-color-accent-080);
    }

    button[data-variant='accent']:hover:enabled {
      background-color: var(--wui-color-accent-glass-015);
    }

    button[data-variant='accent']:active:enabled {
      background-color: var(--wui-color-accent-glass-020);
    }

    button[data-variant='accent-error']:hover:enabled {
      background: var(--wui-color-error-glass-020);
      color: var(--wui-color-error-100);
    }

    button[data-variant='accent-error']:active:enabled {
      background: var(--wui-color-error-glass-030);
      color: var(--wui-color-error-100);
    }

    button[data-variant='accent-success']:hover:enabled {
      background: var(--wui-color-success-glass-020);
      color: var(--wui-color-success-100);
    }

    button[data-variant='accent-success']:active:enabled {
      background: var(--wui-color-success-glass-030);
      color: var(--wui-color-success-100);
    }

    button[data-variant='neutral']:hover:enabled {
      background: var(--wui-color-gray-glass-002);
    }

    button[data-variant='neutral']:active:enabled {
      background: var(--wui-color-gray-glass-005);
    }

    button[data-size='lg'][data-icon-left='true'][data-icon-right='false'] {
      padding-left: var(--wui-spacing-m);
    }

    button[data-size='lg'][data-icon-right='true'][data-icon-left='false'] {
      padding-right: var(--wui-spacing-m);
    }
  }

  /* -- Disabled state --------------------------------------------------- */
  button:disabled {
    background-color: var(--wui-color-gray-glass-002);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-002);
    color: var(--wui-color-gray-glass-020);
    cursor: not-allowed;
  }

  button > wui-text {
    transition: opacity var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: opacity;
    opacity: var(--local-opacity-100);
  }

  ::slotted(*) {
    transition: opacity var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: opacity;
    opacity: var(--local-opacity-100);
  }

  wui-loading-spinner {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    opacity: var(--local-opacity-000);
  }
`;var ae=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};const xn={main:"inverse-100",inverse:"inverse-000",accent:"accent-100","accent-error":"error-100","accent-success":"success-100",neutral:"fg-100",disabled:"gray-glass-020"},Li={lg:"paragraph-600",md:"small-600"},Oi={lg:"md",md:"md"};let Q=class extends O{constructor(){super(...arguments),this.size="lg",this.disabled=!1,this.fullWidth=!1,this.loading=!1,this.variant="main",this.hasIconLeft=!1,this.hasIconRight=!1,this.borderRadius="m"}render(){this.style.cssText=`
    --local-width: ${this.fullWidth?"100%":"auto"};
    --local-opacity-100: ${this.loading?0:1};
    --local-opacity-000: ${this.loading?1:0};
    --local-border-radius: var(--wui-border-radius-${this.borderRadius});
    `;const e=this.textVariant??Li[this.size];return c`
      <button
        data-variant=${this.variant}
        data-icon-left=${this.hasIconLeft}
        data-icon-right=${this.hasIconRight}
        data-size=${this.size}
        ?disabled=${this.disabled}
      >
        ${this.loadingTemplate()}
        <slot name="iconLeft" @slotchange=${()=>this.handleSlotLeftChange()}></slot>
        <wui-text variant=${e} color="inherit">
          <slot></slot>
        </wui-text>
        <slot name="iconRight" @slotchange=${()=>this.handleSlotRightChange()}></slot>
      </button>
    `}handleSlotLeftChange(){this.hasIconLeft=!0}handleSlotRightChange(){this.hasIconRight=!0}loadingTemplate(){if(this.loading){const e=Oi[this.size],n=this.disabled?xn.disabled:xn[this.variant];return c`<wui-loading-spinner color=${n} size=${e}></wui-loading-spinner>`}return c``}};Q.styles=[q,G,Pi];ae([u()],Q.prototype,"size",void 0);ae([u({type:Boolean})],Q.prototype,"disabled",void 0);ae([u({type:Boolean})],Q.prototype,"fullWidth",void 0);ae([u({type:Boolean})],Q.prototype,"loading",void 0);ae([u()],Q.prototype,"variant",void 0);ae([u({type:Boolean})],Q.prototype,"hasIconLeft",void 0);ae([u({type:Boolean})],Q.prototype,"hasIconRight",void 0);ae([u()],Q.prototype,"borderRadius",void 0);ae([u()],Q.prototype,"textVariant",void 0);Q=ae([T("wui-button")],Q);const Ai=N`
  button {
    padding: var(--wui-spacing-4xs) var(--wui-spacing-xxs);
    border-radius: var(--wui-border-radius-3xs);
    background-color: transparent;
    color: var(--wui-color-accent-100);
  }

  button:disabled {
    background-color: transparent;
    color: var(--wui-color-gray-glass-015);
  }

  button:hover {
    background-color: var(--wui-color-gray-glass-005);
  }
`;var vt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Be=class extends O{constructor(){super(...arguments),this.tabIdx=void 0,this.disabled=!1,this.color="inherit"}render(){return c`
      <button ?disabled=${this.disabled} tabindex=${W(this.tabIdx)}>
        <slot name="iconLeft"></slot>
        <wui-text variant="small-600" color=${this.color}>
          <slot></slot>
        </wui-text>
        <slot name="iconRight"></slot>
      </button>
    `}};Be.styles=[q,G,Ai];vt([u()],Be.prototype,"tabIdx",void 0);vt([u({type:Boolean})],Be.prototype,"disabled",void 0);vt([u()],Be.prototype,"color",void 0);Be=vt([T("wui-link")],Be);const ji=N`
  :host {
    display: block;
    width: var(--wui-box-size-md);
    height: var(--wui-box-size-md);
  }

  svg {
    width: var(--wui-box-size-md);
    height: var(--wui-box-size-md);
  }

  rect {
    fill: none;
    stroke: var(--wui-color-accent-100);
    stroke-width: 4px;
    stroke-linecap: round;
    animation: dash 1s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: 0px;
    }
  }
`;var ri=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let at=class extends O{constructor(){super(...arguments),this.radius=36}render(){return this.svgLoaderTemplate()}svgLoaderTemplate(){const e=this.radius>50?50:this.radius,i=36-e,o=116+i,t=245+i,a=360+i*1.75;return c`
      <svg viewBox="0 0 110 110" width="110" height="110">
        <rect
          x="2"
          y="2"
          width="106"
          height="106"
          rx=${e}
          stroke-dasharray="${o} ${t}"
          stroke-dashoffset=${a}
        />
      </svg>
    `}};at.styles=[q,ji];ri([u({type:Number})],at.prototype,"radius",void 0);at=ri([T("wui-loading-thumbnail")],at);const ki=N`
  button {
    border: none;
    border-radius: var(--wui-border-radius-3xl);
  }

  button[data-variant='main'] {
    background-color: var(--wui-color-accent-100);
    color: var(--wui-color-inverse-100);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-010);
  }

  button[data-variant='accent'] {
    background-color: var(--wui-color-accent-glass-010);
    color: var(--wui-color-accent-100);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-005);
  }

  button[data-variant='gray'] {
    background-color: transparent;
    color: var(--wui-color-fg-200);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-010);
  }

  button[data-variant='shade'] {
    background-color: transparent;
    color: var(--wui-color-accent-100);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-010);
  }

  button[data-size='sm'] {
    height: 32px;
    padding: 0 var(--wui-spacing-s);
  }

  button[data-size='md'] {
    height: 40px;
    padding: 0 var(--wui-spacing-l);
  }

  button[data-size='sm'] > wui-image {
    width: 16px;
    height: 16px;
  }

  button[data-size='md'] > wui-image {
    width: 24px;
    height: 24px;
  }

  button[data-size='sm'] > wui-icon {
    width: 12px;
    height: 12px;
  }

  button[data-size='md'] > wui-icon {
    width: 14px;
    height: 14px;
  }

  wui-image {
    border-radius: var(--wui-border-radius-3xl);
    overflow: hidden;
  }

  button.disabled > wui-icon,
  button.disabled > wui-image {
    filter: grayscale(1);
  }

  button[data-variant='main'] > wui-image {
    box-shadow: inset 0 0 0 1px var(--wui-color-accent-090);
  }

  button[data-variant='shade'] > wui-image,
  button[data-variant='gray'] > wui-image {
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-010);
  }

  @media (hover: hover) and (pointer: fine) {
    button[data-variant='main']:focus-visible {
      background-color: var(--wui-color-accent-090);
    }

    button[data-variant='main']:hover:enabled {
      background-color: var(--wui-color-accent-090);
    }

    button[data-variant='main']:active:enabled {
      background-color: var(--wui-color-accent-080);
    }

    button[data-variant='accent']:hover:enabled {
      background-color: var(--wui-color-accent-glass-015);
    }

    button[data-variant='accent']:active:enabled {
      background-color: var(--wui-color-accent-glass-020);
    }

    button[data-variant='shade']:focus-visible,
    button[data-variant='gray']:focus-visible,
    button[data-variant='shade']:hover,
    button[data-variant='gray']:hover {
      background-color: var(--wui-color-gray-glass-002);
    }

    button[data-variant='gray']:active,
    button[data-variant='shade']:active {
      background-color: var(--wui-color-gray-glass-005);
    }
  }

  button.disabled {
    color: var(--wui-color-gray-glass-020);
    background-color: var(--wui-color-gray-glass-002);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-002);
    pointer-events: none;
  }
`;var Ee=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let pe=class extends O{constructor(){super(...arguments),this.variant="accent",this.imageSrc="",this.disabled=!1,this.icon="externalLink",this.size="md",this.text=""}render(){const e=this.size==="sm"?"small-600":"paragraph-600";return c`
      <button
        class=${this.disabled?"disabled":""}
        data-variant=${this.variant}
        data-size=${this.size}
      >
        ${this.imageSrc?c`<wui-image src=${this.imageSrc}></wui-image>`:null}
        <wui-text variant=${e} color="inherit"> ${this.text} </wui-text>
        <wui-icon name=${this.icon} color="inherit" size="inherit"></wui-icon>
      </button>
    `}};pe.styles=[q,G,ki];Ee([u()],pe.prototype,"variant",void 0);Ee([u()],pe.prototype,"imageSrc",void 0);Ee([u({type:Boolean})],pe.prototype,"disabled",void 0);Ee([u()],pe.prototype,"icon",void 0);Ee([u()],pe.prototype,"size",void 0);Ee([u()],pe.prototype,"text",void 0);pe=Ee([T("wui-chip-button")],pe);const Di=N`
  wui-flex {
    width: 100%;
    background-color: var(--wui-color-gray-glass-002);
    border-radius: var(--wui-border-radius-xs);
  }
`;var yt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Pe=class extends O{constructor(){super(...arguments),this.disabled=!1,this.label="",this.buttonLabel=""}render(){return c`
      <wui-flex
        justifyContent="space-between"
        alignItems="center"
        .padding=${["1xs","2l","1xs","2l"]}
      >
        <wui-text variant="paragraph-500" color="fg-200">${this.label}</wui-text>
        <wui-chip-button size="sm" variant="shade" text=${this.buttonLabel} icon="chevronRight">
        </wui-chip-button>
      </wui-flex>
    `}};Pe.styles=[q,G,Di];yt([u({type:Boolean})],Pe.prototype,"disabled",void 0);yt([u()],Pe.prototype,"label",void 0);yt([u()],Pe.prototype,"buttonLabel",void 0);Pe=yt([T("wui-cta-button")],Pe);const zi=N`
  :host {
    display: block;
    padding: 0 var(--wui-spacing-xl) var(--wui-spacing-xl);
  }
`;var ai=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let st=class extends O{constructor(){super(...arguments),this.wallet=void 0}render(){if(!this.wallet)return this.style.display="none",null;const{name:e,app_store:n,play_store:i,chrome_store:o,homepage:t}=this.wallet,a=j.isMobile(),s=j.isIos(),l=j.isAndroid(),d=[n,i,t,o].filter(Boolean).length>1,p=he.getTruncateString({string:e,charsStart:12,charsEnd:0,truncate:"end"});return d&&!a?c`
        <wui-cta-button
          label=${`Don't have ${p}?`}
          buttonLabel="Get"
          @click=${()=>U.push("Downloads",{wallet:this.wallet})}
        ></wui-cta-button>
      `:!d&&t?c`
        <wui-cta-button
          label=${`Don't have ${p}?`}
          buttonLabel="Get"
          @click=${this.onHomePage.bind(this)}
        ></wui-cta-button>
      `:n&&s?c`
        <wui-cta-button
          label=${`Don't have ${p}?`}
          buttonLabel="Get"
          @click=${this.onAppStore.bind(this)}
        ></wui-cta-button>
      `:i&&l?c`
        <wui-cta-button
          label=${`Don't have ${p}?`}
          buttonLabel="Get"
          @click=${this.onPlayStore.bind(this)}
        ></wui-cta-button>
      `:(this.style.display="none",null)}onAppStore(){this.wallet?.app_store&&j.openHref(this.wallet.app_store,"_blank")}onPlayStore(){this.wallet?.play_store&&j.openHref(this.wallet.play_store,"_blank")}onHomePage(){this.wallet?.homepage&&j.openHref(this.wallet.homepage,"_blank")}};st.styles=[zi];ai([u({type:Object})],st.prototype,"wallet",void 0);st=ai([T("w3m-mobile-download-links")],st);const Ni=N`
  @keyframes shake {
    0% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(3px);
    }
    50% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
    100% {
      transform: translateX(0);
    }
  }

  wui-flex:first-child:not(:only-child) {
    position: relative;
  }

  wui-loading-thumbnail {
    position: absolute;
  }

  wui-icon-box {
    position: absolute;
    right: calc(var(--wui-spacing-3xs) * -1);
    bottom: calc(var(--wui-spacing-3xs) * -1);
    opacity: 0;
    transform: scale(0.5);
    transition-property: opacity, transform;
    transition-duration: var(--wui-duration-lg);
    transition-timing-function: var(--wui-ease-out-power-2);
    will-change: opacity, transform;
  }

  wui-text[align='center'] {
    width: 100%;
    padding: 0px var(--wui-spacing-l);
  }

  [data-error='true'] wui-icon-box {
    opacity: 1;
    transform: scale(1);
  }

  [data-error='true'] > wui-flex:first-child {
    animation: shake 250ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  [data-retry='false'] wui-link {
    display: none;
  }

  [data-retry='true'] wui-link {
    display: block;
    opacity: 1;
  }
`;var se=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};class V extends O{constructor(){super(),this.wallet=U.state.data?.wallet,this.connector=U.state.data?.connector,this.timeout=void 0,this.secondaryBtnIcon="refresh",this.onConnect=void 0,this.onRender=void 0,this.onAutoConnect=void 0,this.isWalletConnect=!0,this.unsubscribe=[],this.imageSrc=K.getWalletImage(this.wallet)??K.getConnectorImage(this.connector),this.name=this.wallet?.name??this.connector?.name??"Wallet",this.isRetrying=!1,this.uri=k.state.wcUri,this.error=k.state.wcError,this.ready=!1,this.showRetry=!1,this.secondaryBtnLabel="Try again",this.secondaryLabel="Accept connection request in the wallet",this.isLoading=!1,this.isMobile=!1,this.onRetry=void 0,this.unsubscribe.push(k.subscribeKey("wcUri",e=>{this.uri=e,this.isRetrying&&this.onRetry&&(this.isRetrying=!1,this.onConnect?.())}),k.subscribeKey("wcError",e=>this.error=e)),(j.isTelegram()||j.isSafari())&&j.isIos()&&k.state.wcUri&&this.onConnect?.()}firstUpdated(){this.onAutoConnect?.(),this.showRetry=!this.onAutoConnect}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),k.setWcError(!1),clearTimeout(this.timeout)}render(){this.onRender?.(),this.onShowRetry();const e=this.error?"Connection can be declined if a previous request is still active":this.secondaryLabel;let n=`Continue in ${this.name}`;return this.error&&(n="Connection declined"),c`
      <wui-flex
        data-error=${W(this.error)}
        data-retry=${this.showRetry}
        flexDirection="column"
        alignItems="center"
        .padding=${["3xl","xl","xl","xl"]}
        gap="xl"
      >
        <wui-flex justifyContent="center" alignItems="center">
          <wui-wallet-image size="lg" imageSrc=${W(this.imageSrc)}></wui-wallet-image>

          ${this.error?null:this.loaderTemplate()}

          <wui-icon-box
            backgroundColor="error-100"
            background="opaque"
            iconColor="error-100"
            icon="close"
            size="sm"
            border
            borderColor="wui-color-bg-125"
          ></wui-icon-box>
        </wui-flex>

        <wui-flex flexDirection="column" alignItems="center" gap="xs">
          <wui-text variant="paragraph-500" color=${this.error?"error-100":"fg-100"}>
            ${n}
          </wui-text>
          <wui-text align="center" variant="small-500" color="fg-200">${e}</wui-text>
        </wui-flex>

        ${this.secondaryBtnLabel?c`
              <wui-button
                variant="accent"
                size="md"
                ?disabled=${this.isRetrying||this.isLoading}
                @click=${this.onTryAgain.bind(this)}
                data-testid="w3m-connecting-widget-secondary-button"
              >
                <wui-icon color="inherit" slot="iconLeft" name=${this.secondaryBtnIcon}></wui-icon>
                ${this.secondaryBtnLabel}
              </wui-button>
            `:null}
      </wui-flex>

      ${this.isWalletConnect?c`
            <wui-flex .padding=${["0","xl","xl","xl"]} justifyContent="center">
              <wui-link @click=${this.onCopyUri} color="fg-200" data-testid="wui-link-copy">
                <wui-icon size="xs" color="fg-200" slot="iconLeft" name="copy"></wui-icon>
                Copy link
              </wui-link>
            </wui-flex>
          `:null}

      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}onShowRetry(){this.error&&!this.showRetry&&(this.showRetry=!0,this.shadowRoot?.querySelector("wui-button")?.animate([{opacity:0},{opacity:1}],{fill:"forwards",easing:"ease"}))}onTryAgain(){k.setWcError(!1),this.onRetry?(this.isRetrying=!0,this.onRetry?.()):this.onConnect?.()}loaderTemplate(){const e=Zt.state.themeVariables["--w3m-border-radius-master"],n=e?parseInt(e.replace("px",""),10):4;return c`<wui-loading-thumbnail radius=${n*9}></wui-loading-thumbnail>`}onCopyUri(){try{this.uri&&(j.copyToClopboard(this.uri),Xe.showSuccess("Link copied"))}catch{Xe.showError("Failed to copy")}}}V.styles=Ni;se([I()],V.prototype,"isRetrying",void 0);se([I()],V.prototype,"uri",void 0);se([I()],V.prototype,"error",void 0);se([I()],V.prototype,"ready",void 0);se([I()],V.prototype,"showRetry",void 0);se([I()],V.prototype,"secondaryBtnLabel",void 0);se([I()],V.prototype,"secondaryLabel",void 0);se([I()],V.prototype,"isLoading",void 0);se([u({type:Boolean})],V.prototype,"isMobile",void 0);se([u()],V.prototype,"onRetry",void 0);var Mi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Cn=class extends V{constructor(){if(super(),!this.wallet)throw new Error("w3m-connecting-wc-browser: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.onAutoConnect=this.onConnectProxy.bind(this),te.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"browser"}})}async onConnectProxy(){try{this.error=!1;const{connectors:e}=M.state,n=e.find(i=>i.type==="ANNOUNCED"&&i.info?.rdns===this.wallet?.rdns||i.type==="INJECTED"||i.name===this.wallet?.name);if(n)await k.connectExternal(n,n.chain);else throw new Error("w3m-connecting-wc-browser: No connector found");ni.close(),te.sendEvent({type:"track",event:"CONNECT_SUCCESS",properties:{method:"browser",name:this.wallet?.name||"Unknown"}})}catch(e){te.sendEvent({type:"track",event:"CONNECT_ERROR",properties:{message:e?.message??"Unknown"}}),this.error=!0}}};Cn=Mi([T("w3m-connecting-wc-browser")],Cn);var Ui=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Rn=class extends V{constructor(){if(super(),!this.wallet)throw new Error("w3m-connecting-wc-desktop: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.onRender=this.onRenderProxy.bind(this),te.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"desktop"}})}onRenderProxy(){!this.ready&&this.uri&&(this.ready=!0,this.onConnect?.())}onConnectProxy(){if(this.wallet?.desktop_link&&this.uri)try{this.error=!1;const{desktop_link:e,name:n}=this.wallet,{redirect:i,href:o}=j.formatNativeUrl(e,this.uri);k.setWcLinking({name:n,href:o}),k.setRecentWallet(this.wallet),j.openHref(i,"_blank")}catch{this.error=!0}}};Rn=Ui([T("w3m-connecting-wc-desktop")],Rn);var je=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Ce=class extends V{constructor(){if(super(),this.btnLabelTimeout=void 0,this.redirectDeeplink=void 0,this.redirectUniversalLink=void 0,this.target=void 0,this.preferUniversalLinks=ee.state.experimental_preferUniversalLinks,this.isLoading=!0,this.onConnect=()=>{if(this.wallet?.mobile_link&&this.uri)try{this.error=!1;const{mobile_link:e,link_mode:n,name:i}=this.wallet,{redirect:o,redirectUniversalLink:t,href:a}=j.formatNativeUrl(e,this.uri,n);this.redirectDeeplink=o,this.redirectUniversalLink=t,this.target=j.isIframe()?"_top":"_self",k.setWcLinking({name:i,href:a}),k.setRecentWallet(this.wallet),this.preferUniversalLinks&&this.redirectUniversalLink?j.openHref(this.redirectUniversalLink,this.target):j.openHref(this.redirectDeeplink,this.target)}catch(e){te.sendEvent({type:"track",event:"CONNECT_PROXY_ERROR",properties:{message:e instanceof Error?e.message:"Error parsing the deeplink",uri:this.uri,mobile_link:this.wallet.mobile_link,name:this.wallet.name}}),this.error=!0}},!this.wallet)throw new Error("w3m-connecting-wc-mobile: No wallet provided");this.secondaryBtnLabel="Open",this.secondaryLabel=ii.CONNECT_LABELS.MOBILE,this.secondaryBtnIcon="externalLink",this.onHandleURI(),this.unsubscribe.push(k.subscribeKey("wcUri",()=>{this.onHandleURI()})),te.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"mobile"}})}disconnectedCallback(){super.disconnectedCallback(),clearTimeout(this.btnLabelTimeout)}onHandleURI(){this.isLoading=!this.uri,!this.ready&&this.uri&&(this.ready=!0,this.onConnect?.())}onTryAgain(){k.setWcError(!1),this.onConnect?.()}};je([I()],Ce.prototype,"redirectDeeplink",void 0);je([I()],Ce.prototype,"redirectUniversalLink",void 0);je([I()],Ce.prototype,"target",void 0);je([I()],Ce.prototype,"preferUniversalLinks",void 0);je([I()],Ce.prototype,"isLoading",void 0);Ce=je([T("w3m-connecting-wc-mobile")],Ce);var Te={},Wt,$n;function qi(){return $n||($n=1,Wt=function(){return typeof Promise=="function"&&Promise.prototype&&Promise.prototype.then}),Wt}var _t={},be={},In;function We(){if(In)return be;In=1;let r;const e=[0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];return be.getSymbolSize=function(i){if(!i)throw new Error('"version" cannot be null or undefined');if(i<1||i>40)throw new Error('"version" should be in range from 1 to 40');return i*4+17},be.getSymbolTotalCodewords=function(i){return e[i]},be.getBCHDigit=function(n){let i=0;for(;n!==0;)i++,n>>>=1;return i},be.setToSJISFunction=function(i){if(typeof i!="function")throw new Error('"toSJISFunc" is not a valid function.');r=i},be.isKanjiModeEnabled=function(){return typeof r<"u"},be.toSJIS=function(i){return r(i)},be}var St={},En;function hn(){return En||(En=1,(function(r){r.L={bit:1},r.M={bit:0},r.Q={bit:3},r.H={bit:2};function e(n){if(typeof n!="string")throw new Error("Param is not a string");switch(n.toLowerCase()){case"l":case"low":return r.L;case"m":case"medium":return r.M;case"q":case"quartile":return r.Q;case"h":case"high":return r.H;default:throw new Error("Unknown EC Level: "+n)}}r.isValid=function(i){return i&&typeof i.bit<"u"&&i.bit>=0&&i.bit<4},r.from=function(i,o){if(r.isValid(i))return i;try{return e(i)}catch{return o}}})(St)),St}var Tt,Wn;function Fi(){if(Wn)return Tt;Wn=1;function r(){this.buffer=[],this.length=0}return r.prototype={get:function(e){const n=Math.floor(e/8);return(this.buffer[n]>>>7-e%8&1)===1},put:function(e,n){for(let i=0;i<n;i++)this.putBit((e>>>n-i-1&1)===1)},getLengthInBits:function(){return this.length},putBit:function(e){const n=Math.floor(this.length/8);this.buffer.length<=n&&this.buffer.push(0),e&&(this.buffer[n]|=128>>>this.length%8),this.length++}},Tt=r,Tt}var Bt,_n;function Vi(){if(_n)return Bt;_n=1;function r(e){if(!e||e<1)throw new Error("BitMatrix size must be defined and greater than 0");this.size=e,this.data=new Uint8Array(e*e),this.reservedBit=new Uint8Array(e*e)}return r.prototype.set=function(e,n,i,o){const t=e*this.size+n;this.data[t]=i,o&&(this.reservedBit[t]=!0)},r.prototype.get=function(e,n){return this.data[e*this.size+n]},r.prototype.xor=function(e,n,i){this.data[e*this.size+n]^=i},r.prototype.isReserved=function(e,n){return this.reservedBit[e*this.size+n]},Bt=r,Bt}var Pt={},Sn;function Ki(){return Sn||(Sn=1,(function(r){const e=We().getSymbolSize;r.getRowColCoords=function(i){if(i===1)return[];const o=Math.floor(i/7)+2,t=e(i),a=t===145?26:Math.ceil((t-13)/(2*o-2))*2,s=[t-7];for(let l=1;l<o-1;l++)s[l]=s[l-1]-a;return s.push(6),s.reverse()},r.getPositions=function(i){const o=[],t=r.getRowColCoords(i),a=t.length;for(let s=0;s<a;s++)for(let l=0;l<a;l++)s===0&&l===0||s===0&&l===a-1||s===a-1&&l===0||o.push([t[s],t[l]]);return o}})(Pt)),Pt}var Lt={},Tn;function Hi(){if(Tn)return Lt;Tn=1;const r=We().getSymbolSize,e=7;return Lt.getPositions=function(i){const o=r(i);return[[0,0],[o-e,0],[0,o-e]]},Lt}var Ot={},Bn;function Gi(){return Bn||(Bn=1,(function(r){r.Patterns={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7};const e={N1:3,N2:3,N3:40,N4:10};r.isValid=function(o){return o!=null&&o!==""&&!isNaN(o)&&o>=0&&o<=7},r.from=function(o){return r.isValid(o)?parseInt(o,10):void 0},r.getPenaltyN1=function(o){const t=o.size;let a=0,s=0,l=0,d=null,p=null;for(let w=0;w<t;w++){s=l=0,d=p=null;for(let C=0;C<t;C++){let g=o.get(w,C);g===d?s++:(s>=5&&(a+=e.N1+(s-5)),d=g,s=1),g=o.get(C,w),g===p?l++:(l>=5&&(a+=e.N1+(l-5)),p=g,l=1)}s>=5&&(a+=e.N1+(s-5)),l>=5&&(a+=e.N1+(l-5))}return a},r.getPenaltyN2=function(o){const t=o.size;let a=0;for(let s=0;s<t-1;s++)for(let l=0;l<t-1;l++){const d=o.get(s,l)+o.get(s,l+1)+o.get(s+1,l)+o.get(s+1,l+1);(d===4||d===0)&&a++}return a*e.N2},r.getPenaltyN3=function(o){const t=o.size;let a=0,s=0,l=0;for(let d=0;d<t;d++){s=l=0;for(let p=0;p<t;p++)s=s<<1&2047|o.get(d,p),p>=10&&(s===1488||s===93)&&a++,l=l<<1&2047|o.get(p,d),p>=10&&(l===1488||l===93)&&a++}return a*e.N3},r.getPenaltyN4=function(o){let t=0;const a=o.data.length;for(let l=0;l<a;l++)t+=o.data[l];return Math.abs(Math.ceil(t*100/a/5)-10)*e.N4};function n(i,o,t){switch(i){case r.Patterns.PATTERN000:return(o+t)%2===0;case r.Patterns.PATTERN001:return o%2===0;case r.Patterns.PATTERN010:return t%3===0;case r.Patterns.PATTERN011:return(o+t)%3===0;case r.Patterns.PATTERN100:return(Math.floor(o/2)+Math.floor(t/3))%2===0;case r.Patterns.PATTERN101:return o*t%2+o*t%3===0;case r.Patterns.PATTERN110:return(o*t%2+o*t%3)%2===0;case r.Patterns.PATTERN111:return(o*t%3+(o+t)%2)%2===0;default:throw new Error("bad maskPattern:"+i)}}r.applyMask=function(o,t){const a=t.size;for(let s=0;s<a;s++)for(let l=0;l<a;l++)t.isReserved(l,s)||t.xor(l,s,n(o,l,s))},r.getBestMask=function(o,t){const a=Object.keys(r.Patterns).length;let s=0,l=1/0;for(let d=0;d<a;d++){t(d),r.applyMask(d,o);const p=r.getPenaltyN1(o)+r.getPenaltyN2(o)+r.getPenaltyN3(o)+r.getPenaltyN4(o);r.applyMask(d,o),p<l&&(l=p,s=d)}return s}})(Ot)),Ot}var Qe={},Pn;function si(){if(Pn)return Qe;Pn=1;const r=hn(),e=[1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81],n=[7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];return Qe.getBlocksCount=function(o,t){switch(t){case r.L:return e[(o-1)*4+0];case r.M:return e[(o-1)*4+1];case r.Q:return e[(o-1)*4+2];case r.H:return e[(o-1)*4+3];default:return}},Qe.getTotalCodewordsCount=function(o,t){switch(t){case r.L:return n[(o-1)*4+0];case r.M:return n[(o-1)*4+1];case r.Q:return n[(o-1)*4+2];case r.H:return n[(o-1)*4+3];default:return}},Qe}var At={},ze={},Ln;function Yi(){if(Ln)return ze;Ln=1;const r=new Uint8Array(512),e=new Uint8Array(256);return(function(){let i=1;for(let o=0;o<255;o++)r[o]=i,e[i]=o,i<<=1,i&256&&(i^=285);for(let o=255;o<512;o++)r[o]=r[o-255]})(),ze.log=function(i){if(i<1)throw new Error("log("+i+")");return e[i]},ze.exp=function(i){return r[i]},ze.mul=function(i,o){return i===0||o===0?0:r[e[i]+e[o]]},ze}var On;function Ji(){return On||(On=1,(function(r){const e=Yi();r.mul=function(i,o){const t=new Uint8Array(i.length+o.length-1);for(let a=0;a<i.length;a++)for(let s=0;s<o.length;s++)t[a+s]^=e.mul(i[a],o[s]);return t},r.mod=function(i,o){let t=new Uint8Array(i);for(;t.length-o.length>=0;){const a=t[0];for(let l=0;l<o.length;l++)t[l]^=e.mul(o[l],a);let s=0;for(;s<t.length&&t[s]===0;)s++;t=t.slice(s)}return t},r.generateECPolynomial=function(i){let o=new Uint8Array([1]);for(let t=0;t<i;t++)o=r.mul(o,new Uint8Array([1,e.exp(t)]));return o}})(At)),At}var jt,An;function Qi(){if(An)return jt;An=1;const r=Ji();function e(n){this.genPoly=void 0,this.degree=n,this.degree&&this.initialize(this.degree)}return e.prototype.initialize=function(i){this.degree=i,this.genPoly=r.generateECPolynomial(this.degree)},e.prototype.encode=function(i){if(!this.genPoly)throw new Error("Encoder not initialized");const o=new Uint8Array(i.length+this.degree);o.set(i);const t=r.mod(o,this.genPoly),a=this.degree-t.length;if(a>0){const s=new Uint8Array(this.degree);return s.set(t,a),s}return t},jt=e,jt}var kt={},Dt={},zt={},jn;function li(){return jn||(jn=1,zt.isValid=function(e){return!isNaN(e)&&e>=1&&e<=40}),zt}var oe={},kn;function ci(){if(kn)return oe;kn=1;const r="[0-9]+",e="[A-Z $%*+\\-./:]+";let n="(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";n=n.replace(/u/g,"\\u");const i="(?:(?![A-Z0-9 $%*+\\-./:]|"+n+`)(?:.|[\r
]))+`;oe.KANJI=new RegExp(n,"g"),oe.BYTE_KANJI=new RegExp("[^A-Z0-9 $%*+\\-./:]+","g"),oe.BYTE=new RegExp(i,"g"),oe.NUMERIC=new RegExp(r,"g"),oe.ALPHANUMERIC=new RegExp(e,"g");const o=new RegExp("^"+n+"$"),t=new RegExp("^"+r+"$"),a=new RegExp("^[A-Z0-9 $%*+\\-./:]+$");return oe.testKanji=function(l){return o.test(l)},oe.testNumeric=function(l){return t.test(l)},oe.testAlphanumeric=function(l){return a.test(l)},oe}var Dn;function _e(){return Dn||(Dn=1,(function(r){const e=li(),n=ci();r.NUMERIC={id:"Numeric",bit:1,ccBits:[10,12,14]},r.ALPHANUMERIC={id:"Alphanumeric",bit:2,ccBits:[9,11,13]},r.BYTE={id:"Byte",bit:4,ccBits:[8,16,16]},r.KANJI={id:"Kanji",bit:8,ccBits:[8,10,12]},r.MIXED={bit:-1},r.getCharCountIndicator=function(t,a){if(!t.ccBits)throw new Error("Invalid mode: "+t);if(!e.isValid(a))throw new Error("Invalid version: "+a);return a>=1&&a<10?t.ccBits[0]:a<27?t.ccBits[1]:t.ccBits[2]},r.getBestModeForData=function(t){return n.testNumeric(t)?r.NUMERIC:n.testAlphanumeric(t)?r.ALPHANUMERIC:n.testKanji(t)?r.KANJI:r.BYTE},r.toString=function(t){if(t&&t.id)return t.id;throw new Error("Invalid mode")},r.isValid=function(t){return t&&t.bit&&t.ccBits};function i(o){if(typeof o!="string")throw new Error("Param is not a string");switch(o.toLowerCase()){case"numeric":return r.NUMERIC;case"alphanumeric":return r.ALPHANUMERIC;case"kanji":return r.KANJI;case"byte":return r.BYTE;default:throw new Error("Unknown mode: "+o)}}r.from=function(t,a){if(r.isValid(t))return t;try{return i(t)}catch{return a}}})(Dt)),Dt}var zn;function Xi(){return zn||(zn=1,(function(r){const e=We(),n=si(),i=hn(),o=_e(),t=li(),a=7973,s=e.getBCHDigit(a);function l(C,g,L){for(let y=1;y<=40;y++)if(g<=r.getCapacity(y,L,C))return y}function d(C,g){return o.getCharCountIndicator(C,g)+4}function p(C,g){let L=0;return C.forEach(function(y){const B=d(y.mode,g);L+=B+y.getBitsLength()}),L}function w(C,g){for(let L=1;L<=40;L++)if(p(C,L)<=r.getCapacity(L,g,o.MIXED))return L}r.from=function(g,L){return t.isValid(g)?parseInt(g,10):L},r.getCapacity=function(g,L,y){if(!t.isValid(g))throw new Error("Invalid QR Code version");typeof y>"u"&&(y=o.BYTE);const B=e.getSymbolTotalCodewords(g),m=n.getTotalCodewordsCount(g,L),f=(B-m)*8;if(y===o.MIXED)return f;const b=f-d(y,g);switch(y){case o.NUMERIC:return Math.floor(b/10*3);case o.ALPHANUMERIC:return Math.floor(b/11*2);case o.KANJI:return Math.floor(b/13);case o.BYTE:default:return Math.floor(b/8)}},r.getBestVersionForData=function(g,L){let y;const B=i.from(L,i.M);if(Array.isArray(g)){if(g.length>1)return w(g,B);if(g.length===0)return 1;y=g[0]}else y=g;return l(y.mode,y.getLength(),B)},r.getEncodedBits=function(g){if(!t.isValid(g)||g<7)throw new Error("Invalid QR Code version");let L=g<<12;for(;e.getBCHDigit(L)-s>=0;)L^=a<<e.getBCHDigit(L)-s;return g<<12|L}})(kt)),kt}var Nt={},Nn;function Zi(){if(Nn)return Nt;Nn=1;const r=We(),e=1335,n=21522,i=r.getBCHDigit(e);return Nt.getEncodedBits=function(t,a){const s=t.bit<<3|a;let l=s<<10;for(;r.getBCHDigit(l)-i>=0;)l^=e<<r.getBCHDigit(l)-i;return(s<<10|l)^n},Nt}var Mt={},Ut,Mn;function eo(){if(Mn)return Ut;Mn=1;const r=_e();function e(n){this.mode=r.NUMERIC,this.data=n.toString()}return e.getBitsLength=function(i){return 10*Math.floor(i/3)+(i%3?i%3*3+1:0)},e.prototype.getLength=function(){return this.data.length},e.prototype.getBitsLength=function(){return e.getBitsLength(this.data.length)},e.prototype.write=function(i){let o,t,a;for(o=0;o+3<=this.data.length;o+=3)t=this.data.substr(o,3),a=parseInt(t,10),i.put(a,10);const s=this.data.length-o;s>0&&(t=this.data.substr(o),a=parseInt(t,10),i.put(a,s*3+1))},Ut=e,Ut}var qt,Un;function to(){if(Un)return qt;Un=1;const r=_e(),e=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"," ","$","%","*","+","-",".","/",":"];function n(i){this.mode=r.ALPHANUMERIC,this.data=i}return n.getBitsLength=function(o){return 11*Math.floor(o/2)+6*(o%2)},n.prototype.getLength=function(){return this.data.length},n.prototype.getBitsLength=function(){return n.getBitsLength(this.data.length)},n.prototype.write=function(o){let t;for(t=0;t+2<=this.data.length;t+=2){let a=e.indexOf(this.data[t])*45;a+=e.indexOf(this.data[t+1]),o.put(a,11)}this.data.length%2&&o.put(e.indexOf(this.data[t]),6)},qt=n,qt}var Ft,qn;function no(){return qn||(qn=1,Ft=function(e){for(var n=[],i=e.length,o=0;o<i;o++){var t=e.charCodeAt(o);if(t>=55296&&t<=56319&&i>o+1){var a=e.charCodeAt(o+1);a>=56320&&a<=57343&&(t=(t-55296)*1024+a-56320+65536,o+=1)}if(t<128){n.push(t);continue}if(t<2048){n.push(t>>6|192),n.push(t&63|128);continue}if(t<55296||t>=57344&&t<65536){n.push(t>>12|224),n.push(t>>6&63|128),n.push(t&63|128);continue}if(t>=65536&&t<=1114111){n.push(t>>18|240),n.push(t>>12&63|128),n.push(t>>6&63|128),n.push(t&63|128);continue}n.push(239,191,189)}return new Uint8Array(n).buffer}),Ft}var Vt,Fn;function io(){if(Fn)return Vt;Fn=1;const r=no(),e=_e();function n(i){this.mode=e.BYTE,typeof i=="string"&&(i=r(i)),this.data=new Uint8Array(i)}return n.getBitsLength=function(o){return o*8},n.prototype.getLength=function(){return this.data.length},n.prototype.getBitsLength=function(){return n.getBitsLength(this.data.length)},n.prototype.write=function(i){for(let o=0,t=this.data.length;o<t;o++)i.put(this.data[o],8)},Vt=n,Vt}var Kt,Vn;function oo(){if(Vn)return Kt;Vn=1;const r=_e(),e=We();function n(i){this.mode=r.KANJI,this.data=i}return n.getBitsLength=function(o){return o*13},n.prototype.getLength=function(){return this.data.length},n.prototype.getBitsLength=function(){return n.getBitsLength(this.data.length)},n.prototype.write=function(i){let o;for(o=0;o<this.data.length;o++){let t=e.toSJIS(this.data[o]);if(t>=33088&&t<=40956)t-=33088;else if(t>=57408&&t<=60351)t-=49472;else throw new Error("Invalid SJIS character: "+this.data[o]+`
Make sure your charset is UTF-8`);t=(t>>>8&255)*192+(t&255),i.put(t,13)}},Kt=n,Kt}var Kn;function ro(){return Kn||(Kn=1,(function(r){const e=_e(),n=eo(),i=to(),o=io(),t=oo(),a=ci(),s=We(),l=Ii();function d(m){return unescape(encodeURIComponent(m)).length}function p(m,f,b){const h=[];let D;for(;(D=m.exec(b))!==null;)h.push({data:D[0],index:D.index,mode:f,length:D[0].length});return h}function w(m){const f=p(a.NUMERIC,e.NUMERIC,m),b=p(a.ALPHANUMERIC,e.ALPHANUMERIC,m);let h,D;return s.isKanjiModeEnabled()?(h=p(a.BYTE,e.BYTE,m),D=p(a.KANJI,e.KANJI,m)):(h=p(a.BYTE_KANJI,e.BYTE,m),D=[]),f.concat(b,h,D).sort(function(_,E){return _.index-E.index}).map(function(_){return{data:_.data,mode:_.mode,length:_.length}})}function C(m,f){switch(f){case e.NUMERIC:return n.getBitsLength(m);case e.ALPHANUMERIC:return i.getBitsLength(m);case e.KANJI:return t.getBitsLength(m);case e.BYTE:return o.getBitsLength(m)}}function g(m){return m.reduce(function(f,b){const h=f.length-1>=0?f[f.length-1]:null;return h&&h.mode===b.mode?(f[f.length-1].data+=b.data,f):(f.push(b),f)},[])}function L(m){const f=[];for(let b=0;b<m.length;b++){const h=m[b];switch(h.mode){case e.NUMERIC:f.push([h,{data:h.data,mode:e.ALPHANUMERIC,length:h.length},{data:h.data,mode:e.BYTE,length:h.length}]);break;case e.ALPHANUMERIC:f.push([h,{data:h.data,mode:e.BYTE,length:h.length}]);break;case e.KANJI:f.push([h,{data:h.data,mode:e.BYTE,length:d(h.data)}]);break;case e.BYTE:f.push([{data:h.data,mode:e.BYTE,length:d(h.data)}])}}return f}function y(m,f){const b={},h={start:{}};let D=["start"];for(let x=0;x<m.length;x++){const _=m[x],E=[];for(let v=0;v<_.length;v++){const P=_[v],R=""+x+v;E.push(R),b[R]={node:P,lastCount:0},h[R]={};for(let S=0;S<D.length;S++){const $=D[S];b[$]&&b[$].node.mode===P.mode?(h[$][R]=C(b[$].lastCount+P.length,P.mode)-C(b[$].lastCount,P.mode),b[$].lastCount+=P.length):(b[$]&&(b[$].lastCount=P.length),h[$][R]=C(P.length,P.mode)+4+e.getCharCountIndicator(P.mode,f))}}D=E}for(let x=0;x<D.length;x++)h[D[x]].end=0;return{map:h,table:b}}function B(m,f){let b;const h=e.getBestModeForData(m);if(b=e.from(f,h),b!==e.BYTE&&b.bit<h.bit)throw new Error('"'+m+'" cannot be encoded with mode '+e.toString(b)+`.
 Suggested mode is: `+e.toString(h));switch(b===e.KANJI&&!s.isKanjiModeEnabled()&&(b=e.BYTE),b){case e.NUMERIC:return new n(m);case e.ALPHANUMERIC:return new i(m);case e.KANJI:return new t(m);case e.BYTE:return new o(m)}}r.fromArray=function(f){return f.reduce(function(b,h){return typeof h=="string"?b.push(B(h,null)):h.data&&b.push(B(h.data,h.mode)),b},[])},r.fromString=function(f,b){const h=w(f,s.isKanjiModeEnabled()),D=L(h),x=y(D,b),_=l.find_path(x.map,"start","end"),E=[];for(let v=1;v<_.length-1;v++)E.push(x.table[_[v]].node);return r.fromArray(g(E))},r.rawSplit=function(f){return r.fromArray(w(f,s.isKanjiModeEnabled()))}})(Mt)),Mt}var Hn;function ao(){if(Hn)return _t;Hn=1;const r=We(),e=hn(),n=Fi(),i=Vi(),o=Ki(),t=Hi(),a=Gi(),s=si(),l=Qi(),d=Xi(),p=Zi(),w=_e(),C=ro();function g(x,_){const E=x.size,v=t.getPositions(_);for(let P=0;P<v.length;P++){const R=v[P][0],S=v[P][1];for(let $=-1;$<=7;$++)if(!(R+$<=-1||E<=R+$))for(let A=-1;A<=7;A++)S+A<=-1||E<=S+A||($>=0&&$<=6&&(A===0||A===6)||A>=0&&A<=6&&($===0||$===6)||$>=2&&$<=4&&A>=2&&A<=4?x.set(R+$,S+A,!0,!0):x.set(R+$,S+A,!1,!0))}}function L(x){const _=x.size;for(let E=8;E<_-8;E++){const v=E%2===0;x.set(E,6,v,!0),x.set(6,E,v,!0)}}function y(x,_){const E=o.getPositions(_);for(let v=0;v<E.length;v++){const P=E[v][0],R=E[v][1];for(let S=-2;S<=2;S++)for(let $=-2;$<=2;$++)S===-2||S===2||$===-2||$===2||S===0&&$===0?x.set(P+S,R+$,!0,!0):x.set(P+S,R+$,!1,!0)}}function B(x,_){const E=x.size,v=d.getEncodedBits(_);let P,R,S;for(let $=0;$<18;$++)P=Math.floor($/3),R=$%3+E-8-3,S=(v>>$&1)===1,x.set(P,R,S,!0),x.set(R,P,S,!0)}function m(x,_,E){const v=x.size,P=p.getEncodedBits(_,E);let R,S;for(R=0;R<15;R++)S=(P>>R&1)===1,R<6?x.set(R,8,S,!0):R<8?x.set(R+1,8,S,!0):x.set(v-15+R,8,S,!0),R<8?x.set(8,v-R-1,S,!0):R<9?x.set(8,15-R-1+1,S,!0):x.set(8,15-R-1,S,!0);x.set(v-8,8,1,!0)}function f(x,_){const E=x.size;let v=-1,P=E-1,R=7,S=0;for(let $=E-1;$>0;$-=2)for($===6&&$--;;){for(let A=0;A<2;A++)if(!x.isReserved(P,$-A)){let we=!1;S<_.length&&(we=(_[S]>>>R&1)===1),x.set(P,$-A,we),R--,R===-1&&(S++,R=7)}if(P+=v,P<0||E<=P){P-=v,v=-v;break}}}function b(x,_,E){const v=new n;E.forEach(function(A){v.put(A.mode.bit,4),v.put(A.getLength(),w.getCharCountIndicator(A.mode,x)),A.write(v)});const P=r.getSymbolTotalCodewords(x),R=s.getTotalCodewordsCount(x,_),S=(P-R)*8;for(v.getLengthInBits()+4<=S&&v.put(0,4);v.getLengthInBits()%8!==0;)v.putBit(0);const $=(S-v.getLengthInBits())/8;for(let A=0;A<$;A++)v.put(A%2?17:236,8);return h(v,x,_)}function h(x,_,E){const v=r.getSymbolTotalCodewords(_),P=s.getTotalCodewordsCount(_,E),R=v-P,S=s.getBlocksCount(_,E),$=v%S,A=S-$,we=Math.floor(v/S),De=Math.floor(R/S),bi=De+1,wn=we-De,mi=new l(wn);let Ct=0;const Je=new Array(S),bn=new Array(S);let Rt=0;const vi=new Uint8Array(x.buffer);for(let Se=0;Se<S;Se++){const It=Se<A?De:bi;Je[Se]=vi.slice(Ct,Ct+It),bn[Se]=mi.encode(Je[Se]),Ct+=It,Rt=Math.max(Rt,It)}const $t=new Uint8Array(v);let mn=0,ce,ue;for(ce=0;ce<Rt;ce++)for(ue=0;ue<S;ue++)ce<Je[ue].length&&($t[mn++]=Je[ue][ce]);for(ce=0;ce<wn;ce++)for(ue=0;ue<S;ue++)$t[mn++]=bn[ue][ce];return $t}function D(x,_,E,v){let P;if(Array.isArray(x))P=C.fromArray(x);else if(typeof x=="string"){let we=_;if(!we){const De=C.rawSplit(x);we=d.getBestVersionForData(De,E)}P=C.fromString(x,we||40)}else throw new Error("Invalid data");const R=d.getBestVersionForData(P,E);if(!R)throw new Error("The amount of data is too big to be stored in a QR Code");if(!_)_=R;else if(_<R)throw new Error(`
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: `+R+`.
`);const S=b(_,E,P),$=r.getSymbolSize(_),A=new i($);return g(A,_),L(A),y(A,_),m(A,E,0),_>=7&&B(A,_),f(A,S),isNaN(v)&&(v=a.getBestMask(A,m.bind(null,A,E))),a.applyMask(v,A),m(A,E,v),{modules:A,version:_,errorCorrectionLevel:E,maskPattern:v,segments:P}}return _t.create=function(_,E){if(typeof _>"u"||_==="")throw new Error("No input text");let v=e.M,P,R;return typeof E<"u"&&(v=e.from(E.errorCorrectionLevel,e.M),P=d.from(E.version),R=a.from(E.maskPattern),E.toSJISFunc&&r.setToSJISFunction(E.toSJISFunc)),D(_,P,v,R)},_t}var Ht={},Gt={},Gn;function ui(){return Gn||(Gn=1,(function(r){function e(n){if(typeof n=="number"&&(n=n.toString()),typeof n!="string")throw new Error("Color should be defined as hex string");let i=n.slice().replace("#","").split("");if(i.length<3||i.length===5||i.length>8)throw new Error("Invalid hex color: "+n);(i.length===3||i.length===4)&&(i=Array.prototype.concat.apply([],i.map(function(t){return[t,t]}))),i.length===6&&i.push("F","F");const o=parseInt(i.join(""),16);return{r:o>>24&255,g:o>>16&255,b:o>>8&255,a:o&255,hex:"#"+i.slice(0,6).join("")}}r.getOptions=function(i){i||(i={}),i.color||(i.color={});const o=typeof i.margin>"u"||i.margin===null||i.margin<0?4:i.margin,t=i.width&&i.width>=21?i.width:void 0,a=i.scale||4;return{width:t,scale:t?4:a,margin:o,color:{dark:e(i.color.dark||"#000000ff"),light:e(i.color.light||"#ffffffff")},type:i.type,rendererOpts:i.rendererOpts||{}}},r.getScale=function(i,o){return o.width&&o.width>=i+o.margin*2?o.width/(i+o.margin*2):o.scale},r.getImageWidth=function(i,o){const t=r.getScale(i,o);return Math.floor((i+o.margin*2)*t)},r.qrToImageData=function(i,o,t){const a=o.modules.size,s=o.modules.data,l=r.getScale(a,t),d=Math.floor((a+t.margin*2)*l),p=t.margin*l,w=[t.color.light,t.color.dark];for(let C=0;C<d;C++)for(let g=0;g<d;g++){let L=(C*d+g)*4,y=t.color.light;if(C>=p&&g>=p&&C<d-p&&g<d-p){const B=Math.floor((C-p)/l),m=Math.floor((g-p)/l);y=w[s[B*a+m]?1:0]}i[L++]=y.r,i[L++]=y.g,i[L++]=y.b,i[L]=y.a}}})(Gt)),Gt}var Yn;function so(){return Yn||(Yn=1,(function(r){const e=ui();function n(o,t,a){o.clearRect(0,0,t.width,t.height),t.style||(t.style={}),t.height=a,t.width=a,t.style.height=a+"px",t.style.width=a+"px"}function i(){try{return document.createElement("canvas")}catch{throw new Error("You need to specify a canvas element")}}r.render=function(t,a,s){let l=s,d=a;typeof l>"u"&&(!a||!a.getContext)&&(l=a,a=void 0),a||(d=i()),l=e.getOptions(l);const p=e.getImageWidth(t.modules.size,l),w=d.getContext("2d"),C=w.createImageData(p,p);return e.qrToImageData(C.data,t,l),n(w,d,p),w.putImageData(C,0,0),d},r.renderToDataURL=function(t,a,s){let l=s;typeof l>"u"&&(!a||!a.getContext)&&(l=a,a=void 0),l||(l={});const d=r.render(t,a,l),p=l.type||"image/png",w=l.rendererOpts||{};return d.toDataURL(p,w.quality)}})(Ht)),Ht}var Yt={},Jn;function lo(){if(Jn)return Yt;Jn=1;const r=ui();function e(o,t){const a=o.a/255,s=t+'="'+o.hex+'"';return a<1?s+" "+t+'-opacity="'+a.toFixed(2).slice(1)+'"':s}function n(o,t,a){let s=o+t;return typeof a<"u"&&(s+=" "+a),s}function i(o,t,a){let s="",l=0,d=!1,p=0;for(let w=0;w<o.length;w++){const C=Math.floor(w%t),g=Math.floor(w/t);!C&&!d&&(d=!0),o[w]?(p++,w>0&&C>0&&o[w-1]||(s+=d?n("M",C+a,.5+g+a):n("m",l,0),l=0,d=!1),C+1<t&&o[w+1]||(s+=n("h",p),p=0)):l++}return s}return Yt.render=function(t,a,s){const l=r.getOptions(a),d=t.modules.size,p=t.modules.data,w=d+l.margin*2,C=l.color.light.a?"<path "+e(l.color.light,"fill")+' d="M0 0h'+w+"v"+w+'H0z"/>':"",g="<path "+e(l.color.dark,"stroke")+' d="'+i(p,d,l.margin)+'"/>',L='viewBox="0 0 '+w+" "+w+'"',B='<svg xmlns="http://www.w3.org/2000/svg" '+(l.width?'width="'+l.width+'" height="'+l.width+'" ':"")+L+' shape-rendering="crispEdges">'+C+g+`</svg>
`;return typeof s=="function"&&s(null,B),B},Yt}var Qn;function co(){if(Qn)return Te;Qn=1;const r=qi(),e=ao(),n=so(),i=lo();function o(t,a,s,l,d){const p=[].slice.call(arguments,1),w=p.length,C=typeof p[w-1]=="function";if(!C&&!r())throw new Error("Callback required as last argument");if(C){if(w<2)throw new Error("Too few arguments provided");w===2?(d=s,s=a,a=l=void 0):w===3&&(a.getContext&&typeof d>"u"?(d=l,l=void 0):(d=l,l=s,s=a,a=void 0))}else{if(w<1)throw new Error("Too few arguments provided");return w===1?(s=a,a=l=void 0):w===2&&!a.getContext&&(l=s,s=a,a=void 0),new Promise(function(g,L){try{const y=e.create(s,l);g(t(y,a,l))}catch(y){L(y)}})}try{const g=e.create(s,l);d(null,t(g,a,l))}catch(g){d(g)}}return Te.create=e.create,Te.toCanvas=o.bind(null,n.render),Te.toDataURL=o.bind(null,n.renderToDataURL),Te.toString=o.bind(null,function(t,a,s){return i.render(t,s)}),Te}var uo=co();const ho=Ei(uo),fo=.1,Xn=2.5,de=7;function Jt(r,e,n){return r===e?!1:(r-e<0?e-r:r-e)<=n+fo}function po(r,e){const n=Array.prototype.slice.call(ho.create(r,{errorCorrectionLevel:e}).modules.data,0),i=Math.sqrt(n.length);return n.reduce((o,t,a)=>(a%i===0?o.push([t]):o[o.length-1].push(t))&&o,[])}const go={generate({uri:r,size:e,logoSize:n,dotColor:i="#141414"}){const o="transparent",a=[],s=po(r,"Q"),l=e/s.length,d=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];d.forEach(({x:y,y:B})=>{const m=(s.length-de)*l*y,f=(s.length-de)*l*B,b=.45;for(let h=0;h<d.length;h+=1){const D=l*(de-h*2);a.push(Ne`
            <rect
              fill=${h===2?i:o}
              width=${h===0?D-5:D}
              rx= ${h===0?(D-5)*b:D*b}
              ry= ${h===0?(D-5)*b:D*b}
              stroke=${i}
              stroke-width=${h===0?5:0}
              height=${h===0?D-5:D}
              x= ${h===0?f+l*h+5/2:f+l*h}
              y= ${h===0?m+l*h+5/2:m+l*h}
            />
          `)}});const p=Math.floor((n+25)/l),w=s.length/2-p/2,C=s.length/2+p/2-1,g=[];s.forEach((y,B)=>{y.forEach((m,f)=>{if(s[B][f]&&!(B<de&&f<de||B>s.length-(de+1)&&f<de||B<de&&f>s.length-(de+1))&&!(B>w&&B<C&&f>w&&f<C)){const b=B*l+l/2,h=f*l+l/2;g.push([b,h])}})});const L={};return g.forEach(([y,B])=>{L[y]?L[y]?.push(B):L[y]=[B]}),Object.entries(L).map(([y,B])=>{const m=B.filter(f=>B.every(b=>!Jt(f,b,l)));return[Number(y),m]}).forEach(([y,B])=>{B.forEach(m=>{a.push(Ne`<circle cx=${y} cy=${m} fill=${i} r=${l/Xn} />`)})}),Object.entries(L).filter(([y,B])=>B.length>1).map(([y,B])=>{const m=B.filter(f=>B.some(b=>Jt(f,b,l)));return[Number(y),m]}).map(([y,B])=>{B.sort((f,b)=>f<b?-1:1);const m=[];for(const f of B){const b=m.find(h=>h.some(D=>Jt(f,D,l)));b?b.push(f):m.push([f])}return[y,m.map(f=>[f[0],f[f.length-1]])]}).forEach(([y,B])=>{B.forEach(([m,f])=>{a.push(Ne`
              <line
                x1=${y}
                x2=${y}
                y1=${m}
                y2=${f}
                stroke=${i}
                stroke-width=${l/(Xn/2)}
                stroke-linecap="round"
              />
            `)})}),a}},wo=N`
  :host {
    position: relative;
    user-select: none;
    display: block;
    overflow: hidden;
    aspect-ratio: 1 / 1;
    width: var(--local-size);
  }

  :host([data-theme='dark']) {
    border-radius: clamp(0px, var(--wui-border-radius-l), 40px);
    background-color: var(--wui-color-inverse-100);
    padding: var(--wui-spacing-l);
  }

  :host([data-theme='light']) {
    box-shadow: 0 0 0 1px var(--wui-color-bg-125);
    background-color: var(--wui-color-bg-125);
  }

  :host([data-clear='true']) > wui-icon {
    display: none;
  }

  svg:first-child,
  wui-image,
  wui-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translateY(-50%) translateX(-50%);
  }

  wui-image {
    width: 25%;
    height: 25%;
    border-radius: var(--wui-border-radius-xs);
  }

  wui-icon {
    width: 100%;
    height: 100%;
    color: var(--local-icon-color) !important;
    transform: translateY(-50%) translateX(-50%) scale(0.25);
  }
`;var ge=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};const bo="#3396ff";let ne=class extends O{constructor(){super(...arguments),this.uri="",this.size=0,this.theme="dark",this.imageSrc=void 0,this.alt=void 0,this.arenaClear=void 0,this.farcaster=void 0}render(){return this.dataset.theme=this.theme,this.dataset.clear=String(this.arenaClear),this.style.cssText=`
     --local-size: ${this.size}px;
     --local-icon-color: ${this.color??bo}
    `,c`${this.templateVisual()} ${this.templateSvg()}`}templateSvg(){const e=this.theme==="light"?this.size:this.size-32;return Ne`
      <svg height=${e} width=${e}>
        ${go.generate({uri:this.uri,size:e,logoSize:this.arenaClear?0:e/4,dotColor:this.color})}
      </svg>
    `}templateVisual(){return this.imageSrc?c`<wui-image src=${this.imageSrc} alt=${this.alt??"logo"}></wui-image>`:this.farcaster?c`<wui-icon
        class="farcaster"
        size="inherit"
        color="inherit"
        name="farcaster"
      ></wui-icon>`:c`<wui-icon size="inherit" color="inherit" name="walletConnect"></wui-icon>`}};ne.styles=[q,wo];ge([u()],ne.prototype,"uri",void 0);ge([u({type:Number})],ne.prototype,"size",void 0);ge([u()],ne.prototype,"theme",void 0);ge([u()],ne.prototype,"imageSrc",void 0);ge([u()],ne.prototype,"alt",void 0);ge([u()],ne.prototype,"color",void 0);ge([u({type:Boolean})],ne.prototype,"arenaClear",void 0);ge([u({type:Boolean})],ne.prototype,"farcaster",void 0);ne=ge([T("wui-qr-code")],ne);const mo=N`
  :host {
    display: block;
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-005);
    background: linear-gradient(
      120deg,
      var(--wui-color-bg-200) 5%,
      var(--wui-color-bg-200) 48%,
      var(--wui-color-bg-300) 55%,
      var(--wui-color-bg-300) 60%,
      var(--wui-color-bg-300) calc(60% + 10px),
      var(--wui-color-bg-200) calc(60% + 12px),
      var(--wui-color-bg-200) 100%
    );
    background-size: 250%;
    animation: shimmer 3s linear infinite reverse;
  }

  :host([variant='light']) {
    background: linear-gradient(
      120deg,
      var(--wui-color-bg-150) 5%,
      var(--wui-color-bg-150) 48%,
      var(--wui-color-bg-200) 55%,
      var(--wui-color-bg-200) 60%,
      var(--wui-color-bg-200) calc(60% + 10px),
      var(--wui-color-bg-150) calc(60% + 12px),
      var(--wui-color-bg-150) 100%
    );
    background-size: 250%;
  }

  @keyframes shimmer {
    from {
      background-position: -250% 0;
    }
    to {
      background-position: 250% 0;
    }
  }
`;var He=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Re=class extends O{constructor(){super(...arguments),this.width="",this.height="",this.borderRadius="m",this.variant="default"}render(){return this.style.cssText=`
      width: ${this.width};
      height: ${this.height};
      border-radius: ${`clamp(0px,var(--wui-border-radius-${this.borderRadius}), 40px)`};
    `,c`<slot></slot>`}};Re.styles=[mo];He([u()],Re.prototype,"width",void 0);He([u()],Re.prototype,"height",void 0);He([u()],Re.prototype,"borderRadius",void 0);He([u()],Re.prototype,"variant",void 0);Re=He([T("wui-shimmer")],Re);const vo="https://reown.com",yo=N`
  .reown-logo {
    height: var(--wui-spacing-xxl);
  }

  a {
    text-decoration: none;
    cursor: pointer;
  }

  a:hover {
    opacity: 0.9;
  }
`;var xo=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let en=class extends O{render(){return c`
      <a
        data-testid="ux-branding-reown"
        href=${vo}
        rel="noreferrer"
        target="_blank"
        style="text-decoration: none;"
      >
        <wui-flex
          justifyContent="center"
          alignItems="center"
          gap="xs"
          .padding=${["0","0","l","0"]}
        >
          <wui-text variant="small-500" color="fg-100"> UX by </wui-text>
          <wui-icon name="reown" size="xxxl" class="reown-logo"></wui-icon>
        </wui-flex>
      </a>
    `}};en.styles=[q,G,yo];en=xo([T("wui-ux-by-reown")],en);const Co=N`
  @keyframes fadein {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  wui-shimmer {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: clamp(0px, var(--wui-border-radius-l), 40px) !important;
  }

  wui-qr-code {
    opacity: 0;
    animation-duration: 200ms;
    animation-timing-function: ease;
    animation-name: fadein;
    animation-fill-mode: forwards;
  }
`;var Ro=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let tn=class extends V{constructor(){super(),this.forceUpdate=()=>{this.requestUpdate()},window.addEventListener("resize",this.forceUpdate),te.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet?.name??"WalletConnect",platform:"qrcode"}})}disconnectedCallback(){super.disconnectedCallback(),this.unsubscribe?.forEach(e=>e()),window.removeEventListener("resize",this.forceUpdate)}render(){return this.onRenderProxy(),c`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["0","xl","xl","xl"]}
        gap="xl"
      >
        <wui-shimmer borderRadius="l" width="100%"> ${this.qrCodeTemplate()} </wui-shimmer>

        <wui-text variant="paragraph-500" color="fg-100">
          Scan this QR Code with your phone
        </wui-text>
        ${this.copyTemplate()}
      </wui-flex>
      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}onRenderProxy(){!this.ready&&this.uri&&(this.timeout=setTimeout(()=>{this.ready=!0},200))}qrCodeTemplate(){if(!this.uri||!this.ready)return null;const e=this.getBoundingClientRect().width-40,n=this.wallet?this.wallet.name:void 0;return k.setWcLinking(void 0),k.setRecentWallet(this.wallet),c` <wui-qr-code
      size=${e}
      theme=${Zt.state.themeMode}
      uri=${this.uri}
      imageSrc=${W(K.getWalletImage(this.wallet))}
      color=${W(Zt.state.themeVariables["--w3m-qr-color"])}
      alt=${W(n)}
      data-testid="wui-qr-code"
    ></wui-qr-code>`}copyTemplate(){const e=!this.uri||!this.ready;return c`<wui-link
      .disabled=${e}
      @click=${this.onCopyUri}
      color="fg-200"
      data-testid="copy-wc2-uri"
    >
      <wui-icon size="xs" color="fg-200" slot="iconLeft" name="copy"></wui-icon>
      Copy link
    </wui-link>`}};tn.styles=Co;tn=Ro([T("w3m-connecting-wc-qrcode")],tn);var $o=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Zn=class extends O{constructor(){if(super(),this.wallet=U.state.data?.wallet,!this.wallet)throw new Error("w3m-connecting-wc-unsupported: No wallet provided");te.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"browser"}})}render(){return c`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["3xl","xl","xl","xl"]}
        gap="xl"
      >
        <wui-wallet-image
          size="lg"
          imageSrc=${W(K.getWalletImage(this.wallet))}
        ></wui-wallet-image>

        <wui-text variant="paragraph-500" color="fg-100">Not Detected</wui-text>
      </wui-flex>

      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}};Zn=$o([T("w3m-connecting-wc-unsupported")],Zn);var di=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let nn=class extends V{constructor(){if(super(),this.isLoading=!0,!this.wallet)throw new Error("w3m-connecting-wc-web: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.secondaryBtnLabel="Open",this.secondaryLabel=ii.CONNECT_LABELS.MOBILE,this.secondaryBtnIcon="externalLink",this.updateLoadingState(),this.unsubscribe.push(k.subscribeKey("wcUri",()=>{this.updateLoadingState()})),te.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"web"}})}updateLoadingState(){this.isLoading=!this.uri}onConnectProxy(){if(this.wallet?.webapp_link&&this.uri)try{this.error=!1;const{webapp_link:e,name:n}=this.wallet,{redirect:i,href:o}=j.formatUniversalUrl(e,this.uri);k.setWcLinking({name:n,href:o}),k.setRecentWallet(this.wallet),j.openHref(i,"_blank")}catch{this.error=!0}}};di([I()],nn.prototype,"isLoading",void 0);nn=di([T("w3m-connecting-wc-web")],nn);var Ge=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Le=class extends O{constructor(){super(),this.wallet=U.state.data?.wallet,this.unsubscribe=[],this.platform=void 0,this.platforms=[],this.isSiwxEnabled=!!ee.state.siwx,this.remoteFeatures=ee.state.remoteFeatures,this.determinePlatforms(),this.initializeConnection(),this.unsubscribe.push(ee.subscribeKey("remoteFeatures",e=>this.remoteFeatures=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return c`
      ${this.headerTemplate()}
      <div>${this.platformTemplate()}</div>
      ${this.reownBrandingTemplate()}
    `}reownBrandingTemplate(){return this.remoteFeatures?.reownBranding?c`<wui-ux-by-reown></wui-ux-by-reown>`:null}async initializeConnection(e=!1){if(!(this.platform==="browser"||ee.state.manualWCControl&&!e))try{const{wcPairingExpiry:n,status:i}=k.state;(e||ee.state.enableEmbedded||j.isPairingExpired(n)||i==="connecting")&&(await k.connectWalletConnect(),this.isSiwxEnabled||ni.close())}catch(n){te.sendEvent({type:"track",event:"CONNECT_ERROR",properties:{message:n?.message??"Unknown"}}),k.setWcError(!0),Xe.showError(n.message??"Connection error"),k.resetWcConnection(),U.goBack()}}determinePlatforms(){if(!this.wallet){this.platforms.push("qrcode"),this.platform="qrcode";return}if(this.platform)return;const{mobile_link:e,desktop_link:n,webapp_link:i,injected:o,rdns:t}=this.wallet,a=o?.map(({injected_id:L})=>L).filter(Boolean),s=[...t?[t]:a??[]],l=ee.state.isUniversalProvider?!1:s.length,d=e,p=i,w=k.checkInstalled(s),C=l&&w,g=n&&!j.isMobile();C&&!Xt.state.noAdapters&&this.platforms.push("browser"),d&&this.platforms.push(j.isMobile()?"mobile":"qrcode"),p&&this.platforms.push("web"),g&&this.platforms.push("desktop"),!C&&l&&!Xt.state.noAdapters&&this.platforms.push("unsupported"),this.platform=this.platforms[0]}platformTemplate(){switch(this.platform){case"browser":return c`<w3m-connecting-wc-browser></w3m-connecting-wc-browser>`;case"web":return c`<w3m-connecting-wc-web></w3m-connecting-wc-web>`;case"desktop":return c`
          <w3m-connecting-wc-desktop .onRetry=${()=>this.initializeConnection(!0)}>
          </w3m-connecting-wc-desktop>
        `;case"mobile":return c`
          <w3m-connecting-wc-mobile isMobile .onRetry=${()=>this.initializeConnection(!0)}>
          </w3m-connecting-wc-mobile>
        `;case"qrcode":return c`<w3m-connecting-wc-qrcode></w3m-connecting-wc-qrcode>`;default:return c`<w3m-connecting-wc-unsupported></w3m-connecting-wc-unsupported>`}}headerTemplate(){return this.platforms.length>1?c`
      <w3m-connecting-header
        .platforms=${this.platforms}
        .onSelectPlatfrom=${this.onSelectPlatform.bind(this)}
      >
      </w3m-connecting-header>
    `:null}async onSelectPlatform(e){const n=this.shadowRoot?.querySelector("div");n&&(await n.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.platform=e,n.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}};Ge([I()],Le.prototype,"platform",void 0);Ge([I()],Le.prototype,"platforms",void 0);Ge([I()],Le.prototype,"isSiwxEnabled",void 0);Ge([I()],Le.prototype,"remoteFeatures",void 0);Le=Ge([T("w3m-connecting-wc-view")],Le);var hi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let on=class extends O{constructor(){super(...arguments),this.isMobile=j.isMobile()}render(){if(this.isMobile){const{featured:e,recommended:n}=z.state,{customWallets:i}=ee.state,o=ft.getRecentWallets(),t=e.length||n.length||i?.length||o.length;return c`<wui-flex
        flexDirection="column"
        gap="xs"
        .margin=${["3xs","s","s","s"]}
      >
        ${t?c`<w3m-connector-list></w3m-connector-list>`:null}
        <w3m-all-wallets-widget></w3m-all-wallets-widget>
      </wui-flex>`}return c`<wui-flex flexDirection="column" .padding=${["0","0","l","0"]}>
      <w3m-connecting-wc-view></w3m-connecting-wc-view>
      <wui-flex flexDirection="column" .padding=${["0","m","0","m"]}>
        <w3m-all-wallets-widget></w3m-all-wallets-widget> </wui-flex
    ></wui-flex>`}};hi([I()],on.prototype,"isMobile",void 0);on=hi([T("w3m-connecting-wc-basic-view")],on);const fn=()=>new Io;class Io{}const Qt=new WeakMap,pn=Ci(class extends Ri{render(r){return yn}update(r,[e]){const n=e!==this.G;return n&&this.G!==void 0&&this.rt(void 0),(n||this.lt!==this.ct)&&(this.G=e,this.ht=r.options?.host,this.rt(this.ct=r.element)),yn}rt(r){if(this.isConnected||(r=void 0),typeof this.G=="function"){const e=this.ht??globalThis;let n=Qt.get(e);n===void 0&&(n=new WeakMap,Qt.set(e,n)),n.get(this.G)!==void 0&&this.G.call(this.ht,void 0),n.set(this.G,r),r!==void 0&&this.G.call(this.ht,r)}else this.G.value=r}get lt(){return typeof this.G=="function"?Qt.get(this.ht??globalThis)?.get(this.G):this.G?.value}disconnected(){this.lt===this.ct&&this.rt(void 0)}reconnected(){this.rt(this.ct)}}),Eo=N`
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  label {
    position: relative;
    display: inline-block;
    width: 32px;
    height: 22px;
  }

  input {
    width: 0;
    height: 0;
    opacity: 0;
  }

  span {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--wui-color-blue-100);
    border-width: 1px;
    border-style: solid;
    border-color: var(--wui-color-gray-glass-002);
    border-radius: 999px;
    transition:
      background-color var(--wui-ease-inout-power-1) var(--wui-duration-md),
      border-color var(--wui-ease-inout-power-1) var(--wui-duration-md);
    will-change: background-color, border-color;
  }

  span:before {
    position: absolute;
    content: '';
    height: 16px;
    width: 16px;
    left: 3px;
    top: 2px;
    background-color: var(--wui-color-inverse-100);
    transition: transform var(--wui-ease-inout-power-1) var(--wui-duration-lg);
    will-change: transform;
    border-radius: 50%;
  }

  input:checked + span {
    border-color: var(--wui-color-gray-glass-005);
    background-color: var(--wui-color-blue-100);
  }

  input:not(:checked) + span {
    background-color: var(--wui-color-gray-glass-010);
  }

  input:checked + span:before {
    transform: translateX(calc(100% - 7px));
  }
`;var fi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let lt=class extends O{constructor(){super(...arguments),this.inputElementRef=fn(),this.checked=void 0}render(){return c`
      <label>
        <input
          ${pn(this.inputElementRef)}
          type="checkbox"
          ?checked=${W(this.checked)}
          @change=${this.dispatchChangeEvent.bind(this)}
        />
        <span></span>
      </label>
    `}dispatchChangeEvent(){this.dispatchEvent(new CustomEvent("switchChange",{detail:this.inputElementRef.value?.checked,bubbles:!0,composed:!0}))}};lt.styles=[q,G,xi,Eo];fi([u({type:Boolean})],lt.prototype,"checked",void 0);lt=fi([T("wui-switch")],lt);const Wo=N`
  :host {
    height: 100%;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    column-gap: var(--wui-spacing-1xs);
    padding: var(--wui-spacing-xs) var(--wui-spacing-s);
    background-color: var(--wui-color-gray-glass-002);
    border-radius: var(--wui-border-radius-xs);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-002);
    transition: background-color var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: background-color;
    cursor: pointer;
  }

  wui-switch {
    pointer-events: none;
  }
`;var pi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let ct=class extends O{constructor(){super(...arguments),this.checked=void 0}render(){return c`
      <button>
        <wui-icon size="xl" name="walletConnectBrown"></wui-icon>
        <wui-switch ?checked=${W(this.checked)}></wui-switch>
      </button>
    `}};ct.styles=[q,G,Wo];pi([u({type:Boolean})],ct.prototype,"checked",void 0);ct=pi([T("wui-certified-switch")],ct);const _o=N`
  button {
    background-color: var(--wui-color-fg-300);
    border-radius: var(--wui-border-radius-4xs);
    width: 16px;
    height: 16px;
  }

  button:disabled {
    background-color: var(--wui-color-bg-300);
  }

  wui-icon {
    color: var(--wui-color-bg-200) !important;
  }

  button:focus-visible {
    background-color: var(--wui-color-fg-250);
    border: 1px solid var(--wui-color-accent-100);
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover:enabled {
      background-color: var(--wui-color-fg-250);
    }

    button:active:enabled {
      background-color: var(--wui-color-fg-225);
    }
  }
`;var gi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let ut=class extends O{constructor(){super(...arguments),this.icon="copy"}render(){return c`
      <button>
        <wui-icon color="inherit" size="xxs" name=${this.icon}></wui-icon>
      </button>
    `}};ut.styles=[q,G,_o];gi([u()],ut.prototype,"icon",void 0);ut=gi([T("wui-input-element")],ut);const So=N`
  :host {
    position: relative;
    width: 100%;
    display: inline-block;
    color: var(--wui-color-fg-275);
  }

  input {
    width: 100%;
    border-radius: var(--wui-border-radius-xs);
    box-shadow: inset 0 0 0 1px var(--wui-color-gray-glass-002);
    background: var(--wui-color-gray-glass-002);
    font-size: var(--wui-font-size-paragraph);
    letter-spacing: var(--wui-letter-spacing-paragraph);
    color: var(--wui-color-fg-100);
    transition:
      background-color var(--wui-ease-inout-power-1) var(--wui-duration-md),
      border-color var(--wui-ease-inout-power-1) var(--wui-duration-md),
      box-shadow var(--wui-ease-inout-power-1) var(--wui-duration-md);
    will-change: background-color, border-color, box-shadow;
    caret-color: var(--wui-color-accent-100);
  }

  input:disabled {
    cursor: not-allowed;
    border: 1px solid var(--wui-color-gray-glass-010);
  }

  input:disabled::placeholder,
  input:disabled + wui-icon {
    color: var(--wui-color-fg-300);
  }

  input::placeholder {
    color: var(--wui-color-fg-275);
  }

  input:focus:enabled {
    background-color: var(--wui-color-gray-glass-005);
    -webkit-box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0px 0px 0px 4px var(--wui-box-shadow-blue);
    -moz-box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0px 0px 0px 4px var(--wui-box-shadow-blue);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0px 0px 0px 4px var(--wui-box-shadow-blue);
  }

  input:hover:enabled {
    background-color: var(--wui-color-gray-glass-005);
  }

  wui-icon {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .wui-size-sm {
    padding: 9px var(--wui-spacing-m) 10px var(--wui-spacing-s);
  }

  wui-icon + .wui-size-sm {
    padding: 9px var(--wui-spacing-m) 10px 36px;
  }

  wui-icon[data-input='sm'] {
    left: var(--wui-spacing-s);
  }

  .wui-size-md {
    padding: 15px var(--wui-spacing-m) var(--wui-spacing-l) var(--wui-spacing-m);
  }

  wui-icon + .wui-size-md,
  wui-loading-spinner + .wui-size-md {
    padding: 10.5px var(--wui-spacing-3xl) 10.5px var(--wui-spacing-3xl);
  }

  wui-icon[data-input='md'] {
    left: var(--wui-spacing-l);
  }

  .wui-size-lg {
    padding: var(--wui-spacing-s) var(--wui-spacing-s) var(--wui-spacing-s) var(--wui-spacing-l);
    letter-spacing: var(--wui-letter-spacing-medium-title);
    font-size: var(--wui-font-size-medium-title);
    font-weight: var(--wui-font-weight-light);
    line-height: 130%;
    color: var(--wui-color-fg-100);
    height: 64px;
  }

  .wui-padding-right-xs {
    padding-right: var(--wui-spacing-xs);
  }

  .wui-padding-right-s {
    padding-right: var(--wui-spacing-s);
  }

  .wui-padding-right-m {
    padding-right: var(--wui-spacing-m);
  }

  .wui-padding-right-l {
    padding-right: var(--wui-spacing-l);
  }

  .wui-padding-right-xl {
    padding-right: var(--wui-spacing-xl);
  }

  .wui-padding-right-2xl {
    padding-right: var(--wui-spacing-2xl);
  }

  .wui-padding-right-3xl {
    padding-right: var(--wui-spacing-3xl);
  }

  .wui-padding-right-4xl {
    padding-right: var(--wui-spacing-4xl);
  }

  .wui-padding-right-5xl {
    padding-right: var(--wui-spacing-5xl);
  }

  wui-icon + .wui-size-lg,
  wui-loading-spinner + .wui-size-lg {
    padding-left: 50px;
  }

  wui-icon[data-input='lg'] {
    left: var(--wui-spacing-l);
  }

  .wui-size-mdl {
    padding: 17.25px var(--wui-spacing-m) 17.25px var(--wui-spacing-m);
  }
  wui-icon + .wui-size-mdl,
  wui-loading-spinner + .wui-size-mdl {
    padding: 17.25px var(--wui-spacing-3xl) 17.25px 40px;
  }
  wui-icon[data-input='mdl'] {
    left: var(--wui-spacing-m);
  }

  input:placeholder-shown ~ ::slotted(wui-input-element),
  input:placeholder-shown ~ ::slotted(wui-icon) {
    opacity: 0;
    pointer-events: none;
  }

  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type='number'] {
    -moz-appearance: textfield;
  }

  ::slotted(wui-input-element),
  ::slotted(wui-icon) {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
  }

  ::slotted(wui-input-element) {
    right: var(--wui-spacing-m);
  }

  ::slotted(wui-icon) {
    right: 0px;
  }
`;var le=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let X=class extends O{constructor(){super(...arguments),this.inputElementRef=fn(),this.size="md",this.disabled=!1,this.placeholder="",this.type="text",this.value=""}render(){const e=`wui-padding-right-${this.inputRightPadding}`,i={[`wui-size-${this.size}`]:!0,[e]:!!this.inputRightPadding};return c`${this.templateIcon()}
      <input
        data-testid="wui-input-text"
        ${pn(this.inputElementRef)}
        class=${$i(i)}
        type=${this.type}
        enterkeyhint=${W(this.enterKeyHint)}
        ?disabled=${this.disabled}
        placeholder=${this.placeholder}
        @input=${this.dispatchInputChangeEvent.bind(this)}
        .value=${this.value||""}
        tabindex=${W(this.tabIdx)}
      />
      <slot></slot>`}templateIcon(){return this.icon?c`<wui-icon
        data-input=${this.size}
        size=${this.size}
        color="inherit"
        name=${this.icon}
      ></wui-icon>`:null}dispatchInputChangeEvent(){this.dispatchEvent(new CustomEvent("inputChange",{detail:this.inputElementRef.value?.value,bubbles:!0,composed:!0}))}};X.styles=[q,G,So];le([u()],X.prototype,"size",void 0);le([u()],X.prototype,"icon",void 0);le([u({type:Boolean})],X.prototype,"disabled",void 0);le([u()],X.prototype,"placeholder",void 0);le([u()],X.prototype,"type",void 0);le([u()],X.prototype,"keyHint",void 0);le([u()],X.prototype,"value",void 0);le([u()],X.prototype,"inputRightPadding",void 0);le([u()],X.prototype,"tabIdx",void 0);X=le([T("wui-input-text")],X);const To=N`
  :host {
    position: relative;
    display: inline-block;
    width: 100%;
  }
`;var Bo=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let rn=class extends O{constructor(){super(...arguments),this.inputComponentRef=fn()}render(){return c`
      <wui-input-text
        ${pn(this.inputComponentRef)}
        placeholder="Search wallet"
        icon="search"
        type="search"
        enterKeyHint="search"
        size="sm"
      >
        <wui-input-element @click=${this.clearValue} icon="close"></wui-input-element>
      </wui-input-text>
    `}clearValue(){const n=this.inputComponentRef.value?.inputElementRef.value;n&&(n.value="",n.focus(),n.dispatchEvent(new Event("input")))}};rn.styles=[q,To];rn=Bo([T("wui-search-bar")],rn);const Po=Ne`<svg  viewBox="0 0 48 54" fill="none">
  <path
    d="M43.4605 10.7248L28.0485 1.61089C25.5438 0.129705 22.4562 0.129705 19.9515 1.61088L4.53951 10.7248C2.03626 12.2051 0.5 14.9365 0.5 17.886V36.1139C0.5 39.0635 2.03626 41.7949 4.53951 43.2752L19.9515 52.3891C22.4562 53.8703 25.5438 53.8703 28.0485 52.3891L43.4605 43.2752C45.9637 41.7949 47.5 39.0635 47.5 36.114V17.8861C47.5 14.9365 45.9637 12.2051 43.4605 10.7248Z"
  />
</svg>`,Lo=N`
  :host {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 104px;
    row-gap: var(--wui-spacing-xs);
    padding: var(--wui-spacing-xs) 10px;
    background-color: var(--wui-color-gray-glass-002);
    border-radius: clamp(0px, var(--wui-border-radius-xs), 20px);
    position: relative;
  }

  wui-shimmer[data-type='network'] {
    border: none;
    -webkit-clip-path: var(--wui-path-network);
    clip-path: var(--wui-path-network);
  }

  svg {
    position: absolute;
    width: 48px;
    height: 54px;
    z-index: 1;
  }

  svg > path {
    stroke: var(--wui-color-gray-glass-010);
    stroke-width: 1px;
  }

  @media (max-width: 350px) {
    :host {
      width: 100%;
    }
  }
`;var wi=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let dt=class extends O{constructor(){super(...arguments),this.type="wallet"}render(){return c`
      ${this.shimmerTemplate()}
      <wui-shimmer width="56px" height="20px" borderRadius="xs"></wui-shimmer>
    `}shimmerTemplate(){return this.type==="network"?c` <wui-shimmer
          data-type=${this.type}
          width="48px"
          height="54px"
          borderRadius="xs"
        ></wui-shimmer>
        ${Po}`:c`<wui-shimmer width="56px" height="56px" borderRadius="xs"></wui-shimmer>`}};dt.styles=[q,G,Lo];wi([u()],dt.prototype,"type",void 0);dt=wi([T("wui-card-select-loader")],dt);const Oo=N`
  :host {
    display: grid;
    width: inherit;
    height: inherit;
  }
`;var Z=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let H=class extends O{render(){return this.style.cssText=`
      grid-template-rows: ${this.gridTemplateRows};
      grid-template-columns: ${this.gridTemplateColumns};
      justify-items: ${this.justifyItems};
      align-items: ${this.alignItems};
      justify-content: ${this.justifyContent};
      align-content: ${this.alignContent};
      column-gap: ${this.columnGap&&`var(--wui-spacing-${this.columnGap})`};
      row-gap: ${this.rowGap&&`var(--wui-spacing-${this.rowGap})`};
      gap: ${this.gap&&`var(--wui-spacing-${this.gap})`};
      padding-top: ${this.padding&&he.getSpacingStyles(this.padding,0)};
      padding-right: ${this.padding&&he.getSpacingStyles(this.padding,1)};
      padding-bottom: ${this.padding&&he.getSpacingStyles(this.padding,2)};
      padding-left: ${this.padding&&he.getSpacingStyles(this.padding,3)};
      margin-top: ${this.margin&&he.getSpacingStyles(this.margin,0)};
      margin-right: ${this.margin&&he.getSpacingStyles(this.margin,1)};
      margin-bottom: ${this.margin&&he.getSpacingStyles(this.margin,2)};
      margin-left: ${this.margin&&he.getSpacingStyles(this.margin,3)};
    `,c`<slot></slot>`}};H.styles=[q,Oo];Z([u()],H.prototype,"gridTemplateRows",void 0);Z([u()],H.prototype,"gridTemplateColumns",void 0);Z([u()],H.prototype,"justifyItems",void 0);Z([u()],H.prototype,"alignItems",void 0);Z([u()],H.prototype,"justifyContent",void 0);Z([u()],H.prototype,"alignContent",void 0);Z([u()],H.prototype,"columnGap",void 0);Z([u()],H.prototype,"rowGap",void 0);Z([u()],H.prototype,"gap",void 0);Z([u()],H.prototype,"padding",void 0);Z([u()],H.prototype,"margin",void 0);H=Z([T("wui-grid")],H);const Ao=N`
  button {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    width: 104px;
    row-gap: var(--wui-spacing-xs);
    padding: var(--wui-spacing-s) var(--wui-spacing-0);
    background-color: var(--wui-color-gray-glass-002);
    border-radius: clamp(0px, var(--wui-border-radius-xs), 20px);
    transition:
      color var(--wui-duration-lg) var(--wui-ease-out-power-1),
      background-color var(--wui-duration-lg) var(--wui-ease-out-power-1),
      border-radius var(--wui-duration-lg) var(--wui-ease-out-power-1);
    will-change: background-color, color, border-radius;
    outline: none;
    border: none;
  }

  button > wui-flex > wui-text {
    color: var(--wui-color-fg-100);
    max-width: 86px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    justify-content: center;
  }

  button > wui-flex > wui-text.certified {
    max-width: 66px;
  }

  button:hover:enabled {
    background-color: var(--wui-color-gray-glass-005);
  }

  button:disabled > wui-flex > wui-text {
    color: var(--wui-color-gray-glass-015);
  }

  [data-selected='true'] {
    background-color: var(--wui-color-accent-glass-020);
  }

  @media (hover: hover) and (pointer: fine) {
    [data-selected='true']:hover:enabled {
      background-color: var(--wui-color-accent-glass-015);
    }
  }

  [data-selected='true']:active:enabled {
    background-color: var(--wui-color-accent-glass-010);
  }

  @media (max-width: 350px) {
    button {
      width: 100%;
    }
  }
`;var Ye=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let $e=class extends O{constructor(){super(),this.observer=new IntersectionObserver(()=>{}),this.visible=!1,this.imageSrc=void 0,this.imageLoading=!1,this.wallet=void 0,this.observer=new IntersectionObserver(e=>{e.forEach(n=>{n.isIntersecting?(this.visible=!0,this.fetchImageSrc()):this.visible=!1})},{threshold:.01})}firstUpdated(){this.observer.observe(this)}disconnectedCallback(){this.observer.disconnect()}render(){const e=this.wallet?.badge_type==="certified";return c`
      <button>
        ${this.imageTemplate()}
        <wui-flex flexDirection="row" alignItems="center" justifyContent="center" gap="3xs">
          <wui-text
            variant="tiny-500"
            color="inherit"
            class=${W(e?"certified":void 0)}
            >${this.wallet?.name}</wui-text
          >
          ${e?c`<wui-icon size="sm" name="walletConnectBrown"></wui-icon>`:null}
        </wui-flex>
      </button>
    `}imageTemplate(){return!this.visible&&!this.imageSrc||this.imageLoading?this.shimmerTemplate():c`
      <wui-wallet-image
        size="md"
        imageSrc=${W(this.imageSrc)}
        name=${this.wallet?.name}
        .installed=${this.wallet?.installed}
        badgeSize="sm"
      >
      </wui-wallet-image>
    `}shimmerTemplate(){return c`<wui-shimmer width="56px" height="56px" borderRadius="xs"></wui-shimmer>`}async fetchImageSrc(){this.wallet&&(this.imageSrc=K.getWalletImage(this.wallet),!this.imageSrc&&(this.imageLoading=!0,this.imageSrc=await K.fetchWalletImage(this.wallet.image_id),this.imageLoading=!1))}};$e.styles=Ao;Ye([I()],$e.prototype,"visible",void 0);Ye([I()],$e.prototype,"imageSrc",void 0);Ye([I()],$e.prototype,"imageLoading",void 0);Ye([u()],$e.prototype,"wallet",void 0);$e=Ye([T("w3m-all-wallets-list-item")],$e);const jo=N`
  wui-grid {
    max-height: clamp(360px, 400px, 80vh);
    overflow: scroll;
    scrollbar-width: none;
    grid-auto-rows: min-content;
    grid-template-columns: repeat(auto-fill, 104px);
  }

  @media (max-width: 350px) {
    wui-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  wui-grid[data-scroll='false'] {
    overflow: hidden;
  }

  wui-grid::-webkit-scrollbar {
    display: none;
  }

  wui-loading-spinner {
    padding-top: var(--wui-spacing-l);
    padding-bottom: var(--wui-spacing-l);
    justify-content: center;
    grid-column: 1 / span 4;
  }
`;var ke=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};const ei="local-paginator";let me=class extends O{constructor(){super(),this.unsubscribe=[],this.paginationObserver=void 0,this.loading=!z.state.wallets.length,this.wallets=z.state.wallets,this.recommended=z.state.recommended,this.featured=z.state.featured,this.filteredWallets=z.state.filteredWallets,this.unsubscribe.push(z.subscribeKey("wallets",e=>this.wallets=e),z.subscribeKey("recommended",e=>this.recommended=e),z.subscribeKey("featured",e=>this.featured=e),z.subscribeKey("filteredWallets",e=>this.filteredWallets=e))}firstUpdated(){this.initialFetch(),this.createPaginationObserver()}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),this.paginationObserver?.disconnect()}render(){return c`
      <wui-grid
        data-scroll=${!this.loading}
        .padding=${["0","s","s","s"]}
        columnGap="xxs"
        rowGap="l"
        justifyContent="space-between"
      >
        ${this.loading?this.shimmerTemplate(16):this.walletsTemplate()}
        ${this.paginationLoaderTemplate()}
      </wui-grid>
    `}async initialFetch(){this.loading=!0;const e=this.shadowRoot?.querySelector("wui-grid");e&&(await z.fetchWalletsByPage({page:1}),await e.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.loading=!1,e.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}shimmerTemplate(e,n){return[...Array(e)].map(()=>c`
        <wui-card-select-loader type="wallet" id=${W(n)}></wui-card-select-loader>
      `)}walletsTemplate(){const e=this.filteredWallets?.length>0?j.uniqueBy([...this.featured,...this.recommended,...this.filteredWallets],"id"):j.uniqueBy([...this.featured,...this.recommended,...this.wallets],"id");return pt.markWalletsAsInstalled(e).map(i=>c`
        <w3m-all-wallets-list-item
          @click=${()=>this.onConnectWallet(i)}
          .wallet=${i}
        ></w3m-all-wallets-list-item>
      `)}paginationLoaderTemplate(){const{wallets:e,recommended:n,featured:i,count:o}=z.state,t=window.innerWidth<352?3:4,a=e.length+n.length;let l=Math.ceil(a/t)*t-a+t;return l-=e.length?i.length%t:0,o===0&&i.length>0?null:o===0||[...i,...e,...n].length<o?this.shimmerTemplate(l,ei):null}createPaginationObserver(){const e=this.shadowRoot?.querySelector(`#${ei}`);e&&(this.paginationObserver=new IntersectionObserver(([n])=>{if(n?.isIntersecting&&!this.loading){const{page:i,count:o,wallets:t}=z.state;t.length<o&&z.fetchWalletsByPage({page:i+1})}}),this.paginationObserver.observe(e))}onConnectWallet(e){M.selectWalletConnector(e)}};me.styles=jo;ke([I()],me.prototype,"loading",void 0);ke([I()],me.prototype,"wallets",void 0);ke([I()],me.prototype,"recommended",void 0);ke([I()],me.prototype,"featured",void 0);ke([I()],me.prototype,"filteredWallets",void 0);me=ke([T("w3m-all-wallets-list")],me);const ko=N`
  wui-grid,
  wui-loading-spinner,
  wui-flex {
    height: 360px;
  }

  wui-grid {
    overflow: scroll;
    scrollbar-width: none;
    grid-auto-rows: min-content;
    grid-template-columns: repeat(auto-fill, 104px);
  }

  wui-grid[data-scroll='false'] {
    overflow: hidden;
  }

  wui-grid::-webkit-scrollbar {
    display: none;
  }

  wui-loading-spinner {
    justify-content: center;
    align-items: center;
  }

  @media (max-width: 350px) {
    wui-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
`;var xt=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let Oe=class extends O{constructor(){super(...arguments),this.prevQuery="",this.prevBadge=void 0,this.loading=!0,this.query=""}render(){return this.onSearch(),this.loading?c`<wui-loading-spinner color="accent-100"></wui-loading-spinner>`:this.walletsTemplate()}async onSearch(){(this.query.trim()!==this.prevQuery.trim()||this.badge!==this.prevBadge)&&(this.prevQuery=this.query,this.prevBadge=this.badge,this.loading=!0,await z.searchWallet({search:this.query,badge:this.badge}),this.loading=!1)}walletsTemplate(){const{search:e}=z.state,n=pt.markWalletsAsInstalled(e);return e.length?c`
      <wui-grid
        data-testid="wallet-list"
        .padding=${["0","s","s","s"]}
        rowGap="l"
        columnGap="xs"
        justifyContent="space-between"
      >
        ${n.map(i=>c`
            <w3m-all-wallets-list-item
              @click=${()=>this.onConnectWallet(i)}
              .wallet=${i}
              data-testid="wallet-search-item-${i.id}"
            ></w3m-all-wallets-list-item>
          `)}
      </wui-grid>
    `:c`
        <wui-flex
          data-testid="no-wallet-found"
          justifyContent="center"
          alignItems="center"
          gap="s"
          flexDirection="column"
        >
          <wui-icon-box
            size="lg"
            iconColor="fg-200"
            backgroundColor="fg-300"
            icon="wallet"
            background="transparent"
          ></wui-icon-box>
          <wui-text data-testid="no-wallet-found-text" color="fg-200" variant="paragraph-500">
            No Wallet found
          </wui-text>
        </wui-flex>
      `}onConnectWallet(e){M.selectWalletConnector(e)}};Oe.styles=ko;xt([I()],Oe.prototype,"loading",void 0);xt([u()],Oe.prototype,"query",void 0);xt([u()],Oe.prototype,"badge",void 0);Oe=xt([T("w3m-all-wallets-search")],Oe);var gn=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let ht=class extends O{constructor(){super(...arguments),this.search="",this.onDebouncedSearch=j.debounce(e=>{this.search=e})}render(){const e=this.search.length>=2;return c`
      <wui-flex .padding=${["0","s","s","s"]} gap="xs">
        <wui-search-bar @inputChange=${this.onInputChange.bind(this)}></wui-search-bar>
        <wui-certified-switch
          ?checked=${this.badge}
          @click=${this.onClick.bind(this)}
          data-testid="wui-certified-switch"
        ></wui-certified-switch>
        ${this.qrButtonTemplate()}
      </wui-flex>
      ${e||this.badge?c`<w3m-all-wallets-search
            query=${this.search}
            badge=${W(this.badge)}
          ></w3m-all-wallets-search>`:c`<w3m-all-wallets-list badge=${W(this.badge)}></w3m-all-wallets-list>`}
    `}onInputChange(e){this.onDebouncedSearch(e.detail)}onClick(){if(this.badge==="certified"){this.badge=void 0;return}this.badge="certified",Xe.showSvg("Only WalletConnect certified",{icon:"walletConnectBrown",iconColor:"accent-100"})}qrButtonTemplate(){return j.isMobile()?c`
        <wui-icon-box
          size="lg"
          iconSize="xl"
          iconColor="accent-100"
          backgroundColor="accent-100"
          icon="qrCode"
          background="transparent"
          border
          borderColor="wui-accent-glass-010"
          @click=${this.onWalletConnectQr.bind(this)}
        ></wui-icon-box>
      `:null}onWalletConnectQr(){U.push("ConnectingWalletConnect")}};gn([I()],ht.prototype,"search",void 0);gn([I()],ht.prototype,"badge",void 0);ht=gn([T("w3m-all-wallets-view")],ht);const Do=N`
  button {
    column-gap: var(--wui-spacing-s);
    padding: 11px 18px 11px var(--wui-spacing-s);
    width: 100%;
    background-color: var(--wui-color-gray-glass-002);
    border-radius: var(--wui-border-radius-xs);
    color: var(--wui-color-fg-250);
    transition:
      color var(--wui-ease-out-power-1) var(--wui-duration-md),
      background-color var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: color, background-color;
  }

  button[data-iconvariant='square'],
  button[data-iconvariant='square-blue'] {
    padding: 6px 18px 6px 9px;
  }

  button > wui-flex {
    flex: 1;
  }

  button > wui-image {
    width: 32px;
    height: 32px;
    box-shadow: 0 0 0 2px var(--wui-color-gray-glass-005);
    border-radius: var(--wui-border-radius-3xl);
  }

  button > wui-icon {
    width: 36px;
    height: 36px;
    transition: opacity var(--wui-ease-out-power-1) var(--wui-duration-md);
    will-change: opacity;
  }

  button > wui-icon-box[data-variant='blue'] {
    box-shadow: 0 0 0 2px var(--wui-color-accent-glass-005);
  }

  button > wui-icon-box[data-variant='overlay'] {
    box-shadow: 0 0 0 2px var(--wui-color-gray-glass-005);
  }

  button > wui-icon-box[data-variant='square-blue'] {
    border-radius: var(--wui-border-radius-3xs);
    position: relative;
    border: none;
    width: 36px;
    height: 36px;
  }

  button > wui-icon-box[data-variant='square-blue']::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: inherit;
    border: 1px solid var(--wui-color-accent-glass-010);
    pointer-events: none;
  }

  button > wui-icon:last-child {
    width: 14px;
    height: 14px;
  }

  button:disabled {
    color: var(--wui-color-gray-glass-020);
  }

  button[data-loading='true'] > wui-icon {
    opacity: 0;
  }

  wui-loading-spinner {
    position: absolute;
    right: 18px;
    top: 50%;
    transform: translateY(-50%);
  }
`;var ie=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let J=class extends O{constructor(){super(...arguments),this.tabIdx=void 0,this.variant="icon",this.disabled=!1,this.imageSrc=void 0,this.alt=void 0,this.chevron=!1,this.loading=!1}render(){return c`
      <button
        ?disabled=${this.loading?!0:!!this.disabled}
        data-loading=${this.loading}
        data-iconvariant=${W(this.iconVariant)}
        tabindex=${W(this.tabIdx)}
      >
        ${this.loadingTemplate()} ${this.visualTemplate()}
        <wui-flex gap="3xs">
          <slot></slot>
        </wui-flex>
        ${this.chevronTemplate()}
      </button>
    `}visualTemplate(){if(this.variant==="image"&&this.imageSrc)return c`<wui-image src=${this.imageSrc} alt=${this.alt??"list item"}></wui-image>`;if(this.iconVariant==="square"&&this.icon&&this.variant==="icon")return c`<wui-icon name=${this.icon}></wui-icon>`;if(this.variant==="icon"&&this.icon&&this.iconVariant){const e=["blue","square-blue"].includes(this.iconVariant)?"accent-100":"fg-200",n=this.iconVariant==="square-blue"?"mdl":"md",i=this.iconSize?this.iconSize:n;return c`
        <wui-icon-box
          data-variant=${this.iconVariant}
          icon=${this.icon}
          iconSize=${i}
          background="transparent"
          iconColor=${e}
          backgroundColor=${e}
          size=${n}
        ></wui-icon-box>
      `}return null}loadingTemplate(){return this.loading?c`<wui-loading-spinner
        data-testid="wui-list-item-loading-spinner"
        color="fg-300"
      ></wui-loading-spinner>`:c``}chevronTemplate(){return this.chevron?c`<wui-icon size="inherit" color="fg-200" name="chevronRight"></wui-icon>`:null}};J.styles=[q,G,Do];ie([u()],J.prototype,"icon",void 0);ie([u()],J.prototype,"iconSize",void 0);ie([u()],J.prototype,"tabIdx",void 0);ie([u()],J.prototype,"variant",void 0);ie([u()],J.prototype,"iconVariant",void 0);ie([u({type:Boolean})],J.prototype,"disabled",void 0);ie([u()],J.prototype,"imageSrc",void 0);ie([u()],J.prototype,"alt",void 0);ie([u({type:Boolean})],J.prototype,"chevron",void 0);ie([u({type:Boolean})],J.prototype,"loading",void 0);J=ie([T("wui-list-item")],J);var zo=function(r,e,n,i){var o=arguments.length,t=o<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,n):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(r,e,n,i);else for(var s=r.length-1;s>=0;s--)(a=r[s])&&(t=(o<3?a(t):o>3?a(e,n,t):a(e,n))||t);return o>3&&t&&Object.defineProperty(e,n,t),t};let ti=class extends O{constructor(){super(...arguments),this.wallet=U.state.data?.wallet}render(){if(!this.wallet)throw new Error("w3m-downloads-view");return c`
      <wui-flex gap="xs" flexDirection="column" .padding=${["s","s","l","s"]}>
        ${this.chromeTemplate()} ${this.iosTemplate()} ${this.androidTemplate()}
        ${this.homepageTemplate()}
      </wui-flex>
    `}chromeTemplate(){return this.wallet?.chrome_store?c`<wui-list-item
      variant="icon"
      icon="chromeStore"
      iconVariant="square"
      @click=${this.onChromeStore.bind(this)}
      chevron
    >
      <wui-text variant="paragraph-500" color="fg-100">Chrome Extension</wui-text>
    </wui-list-item>`:null}iosTemplate(){return this.wallet?.app_store?c`<wui-list-item
      variant="icon"
      icon="appStore"
      iconVariant="square"
      @click=${this.onAppStore.bind(this)}
      chevron
    >
      <wui-text variant="paragraph-500" color="fg-100">iOS App</wui-text>
    </wui-list-item>`:null}androidTemplate(){return this.wallet?.play_store?c`<wui-list-item
      variant="icon"
      icon="playStore"
      iconVariant="square"
      @click=${this.onPlayStore.bind(this)}
      chevron
    >
      <wui-text variant="paragraph-500" color="fg-100">Android App</wui-text>
    </wui-list-item>`:null}homepageTemplate(){return this.wallet?.homepage?c`
      <wui-list-item
        variant="icon"
        icon="browser"
        iconVariant="square-blue"
        @click=${this.onHomePage.bind(this)}
        chevron
      >
        <wui-text variant="paragraph-500" color="fg-100">Website</wui-text>
      </wui-list-item>
    `:null}onChromeStore(){this.wallet?.chrome_store&&j.openHref(this.wallet.chrome_store,"_blank")}onAppStore(){this.wallet?.app_store&&j.openHref(this.wallet.app_store,"_blank")}onPlayStore(){this.wallet?.play_store&&j.openHref(this.wallet.play_store,"_blank")}onHomePage(){this.wallet?.homepage&&j.openHref(this.wallet.homepage,"_blank")}};ti=zo([T("w3m-downloads-view")],ti);export{ht as W3mAllWalletsView,on as W3mConnectingWcBasicView,ti as W3mDownloadsView};
