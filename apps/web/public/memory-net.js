/* <memory-net variant="A|B|C"> — self-contained Three.js particle-displacement
   sphere. Thousands of points on a Fibonacci sphere, displaced by flowing 3D
   simplex noise and shaded blue → cyan → magenta. Defined as a custom element
   so the React/DC runtime treats it as opaque. Expects window.THREE. */
(function () {
  function whenTHREE(cb) {
    if (window.THREE) return cb();
    var n = 0;
    var id = setInterval(function () {
      if (window.THREE || n++ > 250) { clearInterval(id); if (window.THREE) cb(); }
    }, 40);
  }

  var CONFIGS = {
    A: { count: 7400, radius: 7.4, amp: 3.0, freq: 1.05, size: 125, speed: 0.34 },
    B: { count: 9200, radius: 8.8, amp: 3.5, freq: 1.0,  size: 135, speed: 0.32 },
    C: { count: 8400, radius: 8.4, amp: 3.3, freq: 1.0,  size: 132, speed: 0.30 }
  };

  var SNOISE = [
    'vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    ' const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    ' vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);',
    ' vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);',
    ' vec3 x1=x0-i1+1.0*C.xxx;vec3 x2=x0-i2+2.0*C.xxx;vec3 x3=x0-1.0+3.0*C.xxx;',
    ' i=mod(i,289.0);',
    ' vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    ' float n_=1.0/7.0;vec3 ns=n_*D.wyz-D.xzx;',
    ' vec4 j=p-49.0*floor(p*ns.z*ns.z);',
    ' vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);',
    ' vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);',
    ' vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);',
    ' vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));',
    ' vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    ' vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);',
    ' vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    ' p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
    ' vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;',
    ' return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}'
  ].join('\n');

  var VS = SNOISE + '\n' + [
    'attribute float aRand;',
    'uniform float uTime,uSize,uRadius,uAmp,uFreq,uSpeed;',
    'varying float vN;varying float vMag;varying float vFog;',
    'void main(){',
    ' vec3 dir=normalize(position);',
    ' float t=uTime*uSpeed;',
    ' float n=snoise(dir*uFreq+vec3(0.0,0.0,t));',
    ' n+=0.5*snoise(dir*uFreq*2.1+vec3(t*0.7,0.0,0.0));',
    ' n/=1.5;',
    ' float disp=uRadius+n*uAmp;',
    ' vec3 p=dir*disp;',
    ' vN=clamp(n*0.5+0.5,0.0,1.0);',
    ' vMag=snoise(dir*1.25+vec3(t*0.35,10.0,0.0))*0.5+0.5;',
    ' vec4 mv=modelViewMatrix*vec4(p,1.0);',
    ' vFog=clamp((-mv.z-12.0)/30.0,0.0,1.0);',
    ' gl_PointSize=uSize*(1.0/ -mv.z)*(0.45+vN*0.95)*(0.7+aRand*0.6);',
    ' gl_Position=projectionMatrix*mv;',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying float vN;varying float vMag;varying float vFog;',
    'uniform float uOpacity;',
    'void main(){',
    ' vec2 d=gl_PointCoord-vec2(0.5);float r=length(d);if(r>0.5)discard;',
    ' float a=smoothstep(0.5,0.0,r);',
    ' vec3 deep=vec3(0.03,0.04,0.17);',
    ' vec3 blue=vec3(0.13,0.27,1.0);',
    ' vec3 cyan=vec3(0.30,0.90,1.0);',
    ' vec3 mag=vec3(0.85,0.16,0.76);',
    ' vec3 col=mix(deep,blue,smoothstep(0.0,0.5,vN));',
    ' col=mix(col,cyan,smoothstep(0.52,0.98,vN));',
    ' col=mix(col,mag,smoothstep(0.5,1.0,vMag)*0.62);',
    ' float glow=0.3+vN*vN*1.5+vN*0.35;',
    ' float fade=mix(1.0,0.28,vFog);',
    ' gl_FragColor=vec4(col*glow*fade,a*uOpacity*fade);',
    '}'
  ].join('\n');

  class MemoryNet extends HTMLElement {
    connectedCallback() {
      var self = this;
      if (getComputedStyle(this).position === 'static') this.style.position = 'absolute';
      this.style.display = 'block';
      if (!this._canvas) {
        var cv = document.createElement('canvas');
        cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        this.appendChild(cv);
        this._canvas = cv;
      }
      this._stop = false;
      if (this._built) { this._run(); return; }
      whenTHREE(function () { if (!self._built) self._build(); self._run(); });
    }

    disconnectedCallback() {
      this._stop = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0; this._running = false;
    }

    _build() {
      var THREE = window.THREE;
      var opt = CONFIGS[this.getAttribute('variant')] || CONFIGS.A;
      var cv = this._canvas, host = this;
      var getW = function () { return cv.clientWidth || host.clientWidth || 600; };
      var getH = function () { return cv.clientHeight || host.clientHeight || 600; };
      var w = getW(), h = getH();

      var renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100);
      camera.position.set(0, 0, 26);
      var group = new THREE.Group(); scene.add(group);

      // Fibonacci sphere of unit directions
      var N = opt.count;
      var pos = new Float32Array(N * 3), rnd = new Float32Array(N);
      var ga = Math.PI * (3 - Math.sqrt(5));
      for (var i = 0; i < N; i++) {
        var y = 1 - (i / (N - 1)) * 2;
        var rr = Math.sqrt(Math.max(0, 1 - y * y));
        var th = ga * i;
        pos[i*3] = Math.cos(th) * rr; pos[i*3+1] = y; pos[i*3+2] = Math.sin(th) * rr;
        rnd[i] = Math.random();
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));

      var uni = {
        uTime:   { value: 0 },
        uSize:   { value: opt.size },
        uRadius: { value: opt.radius },
        uAmp:    { value: opt.amp },
        uFreq:   { value: opt.freq },
        uSpeed:  { value: opt.speed },
        uOpacity:{ value: 1.0 }
      };
      var mat = new THREE.ShaderMaterial({
        uniforms: uni, vertexShader: VS, fragmentShader: FS,
        transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending
      });
      group.add(new THREE.Points(geo, mat));

      this._gl = { renderer: renderer, scene: scene, camera: camera, group: group,
                   uni: uni, getW: getW, getH: getH, clock: new THREE.Clock() };
      this._built = true;

      var self = this;
      this._ro = new ResizeObserver(function () {
        var nw = getW(), nh = getH();
        if (nw && nh) { renderer.setSize(nw, nh, false); camera.aspect = nw / nh; camera.updateProjectionMatrix(); }
      });
      this._ro.observe(this);
      this._frame(0);
    }

    _frame(t) {
      var g = this._gl;
      g.uni.uTime.value = t;
      g.group.rotation.y = t * 0.07;
      g.group.rotation.x = Math.sin(t * 0.09) * 0.12;
      g.camera.position.x = Math.sin(t * 0.06) * 1.6;
      g.camera.position.y = Math.cos(t * 0.08) * 1.0;
      g.camera.lookAt(0, 0, 0);
      g.renderer.render(g.scene, g.camera);
    }

    _run() {
      if (this._running || !this._gl) return;
      this._running = true;
      var self = this, g = this._gl;
      var tick = function () {
        if (self._stop) { self._running = false; return; }
        self._frame(g.clock.getElapsedTime());
        self._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
  }

  if (!customElements.get('memory-net')) customElements.define('memory-net', MemoryNet);
})();
