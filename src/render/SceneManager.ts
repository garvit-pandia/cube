import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const FLOOR_Y = -1.88;

/**
 * The camera frames this sphere rather than a fixed position, so the cube fills
 * the viewport consistently and is never clipped at narrow aspects. The centre
 * sits slightly below the origin to leave room for the contact shadow.
 */
const CONTENT_CENTER = new THREE.Vector3(0, -0.2, 0);
const CONTENT_RADIUS = 2.62;
const VIEW_DIRECTION = new THREE.Vector3(3.7, 3.6, 5.05).normalize();

/** Vertical studio gradient used as the scene backdrop. */
function createBackdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#1b2030');
    gradient.addColorStop(0.45, '#12151f');
    gradient.addColorStop(1, '#07080b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft pool of light on the ground so the cast shadow has something to darken. */
function createFloorGlowTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, 'rgba(126, 148, 190, 0.34)');
    gradient.addColorStop(0.42, 'rgba(74, 90, 124, 0.14)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Ambient-occlusion decal placed where the cube meets the floor. A cast shadow
 * alone leaves a floating look because the key light is high; this restores the
 * darkening that contact would produce.
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    gradient.addColorStop(0.34, 'rgba(0, 0, 0, 0.4)');
    gradient.addColorStop(0.66, 'rgba(0, 0, 0, 0.13)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Owns renderer, scene, camera, lighting and the render loop. Knows nothing
 * about the cube's mechanics — callers hook `onBeforeRender` to animate.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  onBeforeRender: ((deltaSeconds: number, elapsedSeconds: number) => void) | null = null;

  readonly container: HTMLElement;
  private frameHooks = new Set<(deltaSeconds: number, elapsedSeconds: number) => void>();
  private resizeObserver: ResizeObserver;
  private clock = new THREE.Clock();
  private backdrop: THREE.Mesh | null = null;
  private backdropTexture: THREE.CanvasTexture | null = null;
  private environment: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private floor: THREE.Mesh | null = null;
  private floorGeometry: THREE.PlaneGeometry | null = null;
  private floorMaterial: THREE.ShadowMaterial | null = null;
  private floorGlow: THREE.Mesh | null = null;
  private floorGlowGeometry: THREE.PlaneGeometry | null = null;
  private floorGlowMaterial: THREE.MeshBasicMaterial | null = null;
  private floorGlowTexture: THREE.CanvasTexture | null = null;
  private contact: THREE.Mesh | null = null;
  private contactGeometry: THREE.PlaneGeometry | null = null;
  private contactMaterial: THREE.MeshBasicMaterial | null = null;
  private contactTexture: THREE.CanvasTexture | null = null;
  private disposed = false;

  private resetFrom = new THREE.Vector3();
  private resetFromTarget = new THREE.Vector3();
  private resetElapsed = 0;
  private resetting = false;
  private defaultPosition = new THREE.Vector3();
  private userHasMovedCamera = false;

  /**
   * Distance at which CONTENT_RADIUS exactly fills the tighter of the two
   * field-of-view axes, so the cube is framed the same way at any aspect and
   * never runs off the edge of a narrow viewport.
   */
  private frameDistance(): number {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    return CONTENT_RADIUS / Math.sin(Math.min(vFov, hFov) / 2);
  }

  /** Recompute the default camera station for the current aspect ratio. */
  private applyFraming(): void {
    const distance = this.frameDistance();
    this.defaultPosition.copy(VIEW_DIRECTION).multiplyScalar(distance).add(CONTENT_CENTER);
    this.controls.target.copy(CONTENT_CENTER);
    this.controls.minDistance = distance * 0.72;
    this.controls.maxDistance = distance * 2;
    this.camera.position.copy(this.defaultPosition);
    this.controls.update();
  }

  constructor(container: HTMLElement) {
    this.container = container;
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap ignores shadow.radius entirely (its shader uses a fixed
    // kernel), so PCF is the type that can actually produce a soft penumbra here.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.copy(VIEW_DIRECTION).multiplyScalar(8).add(CONTENT_CENTER);

    this.buildBackdrop();
    this.buildEnvironment();
    this.buildLights();
    this.buildFloor();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 0.75;
    this.controls.minDistance = 5.0;
    this.controls.maxDistance = 14;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI - 0.18;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener('start', () => {
      this.resetting = false;
      this.userHasMovedCamera = true;
    });
    this.applyFraming();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  /**
   * Register a per-frame callback. Returns an unregister function. Hooks run
   * after `onBeforeRender` and before controls/render, like the controller's
   * own turn animation.
   */
  registerFrameHook(fn: (deltaSeconds: number, elapsedSeconds: number) => void): () => void {
    this.frameHooks.add(fn);
    return () => this.frameHooks.delete(fn);
  }

  private buildBackdrop(): void {
    this.backdropTexture = createBackdropTexture();
    const geometry = new THREE.SphereGeometry(48, 32, 16);
    const material = new THREE.MeshBasicMaterial({
      map: this.backdropTexture,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(geometry, material);
    this.backdrop.name = 'backdrop';
    this.scene.add(this.backdrop);
  }

  private buildEnvironment(): void {
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = this.pmrem.fromScene(room, 0.04).texture;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.5;
    room.dispose?.();
  }

  private buildLights(): void {
    const hemisphere = new THREE.HemisphereLight(0x93a6c4, 0x16161a, 0.22);
    this.scene.add(hemisphere);

    // Key light sits front-left of the camera axis so the cast shadow lands
    // beside the cube instead of hiding behind it, and so the top, front and
    // left faces carry the modelling light.
    const key = new THREE.DirectionalLight(0xfff6ea, 2.5);
    key.position.set(-4.5, 7.0, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    // A tight orthographic frustum around the cube keeps shadow texel density
    // high, which is what stops the shadow edge from stair-stepping.
    key.shadow.camera.left = -3.4;
    key.shadow.camera.right = 3.4;
    key.shadow.camera.top = 3.4;
    key.shadow.camera.bottom = -3.4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.015;
    // PCF scales its 17 tap offsets by this radius, so a large value is what
    // turns the penumbra into a genuinely soft edge rather than a hard cut.
    key.shadow.radius = 14;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xc8d6ec, 0.66);
    fill.position.set(7, 1.5, 4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffc79a, 0.62);
    rim.position.set(2, 3, -7);
    this.scene.add(rim);
  }

  private buildFloor(): void {
    this.floorGlowTexture = createFloorGlowTexture();
    this.floorGlowGeometry = new THREE.PlaneGeometry(26, 26);
    this.floorGlowMaterial = new THREE.MeshBasicMaterial({
      map: this.floorGlowTexture,
      transparent: true,
      depthWrite: false,
    });
    this.floorGlow = new THREE.Mesh(this.floorGlowGeometry, this.floorGlowMaterial);
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.y = FLOOR_Y - 0.012;
    this.floorGlow.renderOrder = 0;
    this.scene.add(this.floorGlow);

    this.contactTexture = createContactShadowTexture();
    this.contactGeometry = new THREE.PlaneGeometry(3.5, 3.5);
    this.contactMaterial = new THREE.MeshBasicMaterial({
      map: this.contactTexture,
      transparent: true,
      depthWrite: false,
    });
    this.contact = new THREE.Mesh(this.contactGeometry, this.contactMaterial);
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = FLOOR_Y - 0.004;
    this.contact.renderOrder = 1;
    this.scene.add(this.contact);

    this.floorGeometry = new THREE.PlaneGeometry(40, 40);
    this.floorMaterial = new THREE.ShadowMaterial({ opacity: 0.6, color: 0x000000 });
    this.floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = FLOOR_Y;
    this.floor.renderOrder = 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  private handleResize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    // Only re-frame automatically if the user has not taken over the camera;
    // yanking their viewpoint on a rotation would be hostile.
    if (!this.userHasMovedCamera && !this.resetting) this.applyFraming();
  }

  /** Smoothly return the camera to its default framing. */
  resetView(reducedMotion = false): void {
    // OrbitControls keeps applying leftover drag inertia each update(), which
    // would keep rotating the camera underneath the reset animation and leave
    // it somewhere other than the default. Running one update with damping off
    // applies that residual once and zeroes it, so the animation is the only
    // thing moving the camera afterwards.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;

    if (reducedMotion) {
      this.camera.position.copy(this.defaultPosition);
      this.controls.target.copy(CONTENT_CENTER);
      this.controls.update();
      this.resetting = false;
      this.userHasMovedCamera = false;
      return;
    }
    this.resetFrom.copy(this.camera.position);
    this.resetFromTarget.copy(this.controls.target);
    this.resetElapsed = 0;
    this.resetting = true;
  }

  /** Advance and draw exactly one frame. */
  tick(): void {
    if (this.disposed) return;
    const delta = this.clock.getDelta();
    if (this.resetting) {
      this.resetElapsed += delta;
      const t = Math.min(this.resetElapsed / 0.6, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this.resetFrom, this.defaultPosition, eased);
      this.controls.target.lerpVectors(this.resetFromTarget, CONTENT_CENTER, eased);
      if (t >= 1) {
        this.resetting = false;
        this.userHasMovedCamera = false;
      }
    }
    this.onBeforeRender?.(delta, this.clock.elapsedTime);
    for (const hook of this.frameHooks) hook(delta, this.clock.elapsedTime);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.onBeforeRender = null;
    this.frameHooks.clear();

    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });

    this.environment?.dispose();
    this.pmrem?.dispose();
    this.backdropTexture?.dispose();
    this.floorGlowTexture?.dispose();
    this.contactTexture?.dispose();
    this.resetState();
    this.controls.target.set(0, 0, 0);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resetState(): void {
    this.backdrop = null;
    this.floor = null;
    this.floorGeometry = null;
    this.floorMaterial = null;
    this.floorGlow = null;
    this.floorGlowGeometry = null;
    this.floorGlowMaterial = null;
    this.floorGlowTexture = null;
    this.contact = null;
    this.contactGeometry = null;
    this.contactMaterial = null;
    this.contactTexture = null;
  }
}
