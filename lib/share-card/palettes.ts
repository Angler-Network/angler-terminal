/**
 * Share card colors, all in code: every palette recolors the same six source textures with a WebGL shader that rotates
 * hue in OKLab, keeps lightness, leaves neutral reflections alone and pulls chroma back into sRGB. No per-palette
 * images. Ported from the design kit (design-kits/share-cards/src/palettes.js).
 */

export type PaletteId = "native" | "cobalt" | "ice" | "violet" | "mint" | "amber";

export interface Palette {
  id: PaletteId;
  name: string;
  swatch: string;
  hue?: number;
  chroma?: number;
}

export const PALETTES: readonly Palette[] = Object.freeze([
  { id: "native", name: "Original", swatch: "#b6cff1" },
  { id: "cobalt", name: "Cobalt", swatch: "#719eff", hue: 264, chroma: 1 },
  { id: "ice", name: "Ice", swatch: "#c6e4ff", hue: 246, chroma: 0.48 },
  { id: "violet", name: "Violet", swatch: "#c0a2ff", hue: 300, chroma: 0.94 },
  { id: "mint", name: "Mint", swatch: "#8ce5c7", hue: 166, chroma: 0.86 },
  { id: "amber", name: "Amber", swatch: "#f5c480", hue: 78, chroma: 0.86 },
]);

/** The palette with its text accent: the design's own on the original artwork, else the palette's swatch. */
export function paletteFor(id: PaletteId, designAccent: string) {
  const palette = PALETTES.find((p) => p.id === id);
  if (!palette) throw new RangeError(`Unknown palette: ${id}`);
  return { ...palette, accent: palette.id === "native" ? designAccent : palette.swatch };
}

const vertex = `attribute vec2 a_position;varying vec2 v_uv;void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.,1.);}`;
const fragment = `
precision highp float;
varying vec2 v_uv; uniform sampler2D u_image; uniform float u_shift; uniform float u_chroma;
vec3 linearize(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
vec3 encode(vec3 c){c=max(c,vec3(0.));return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-0.055,step(vec3(0.0031308),c));}
vec3 lab(vec3 rgb){
 vec3 lms=vec3(dot(rgb,vec3(.4122214708,.5363325363,.0514459929)),dot(rgb,vec3(.2119034982,.6806995451,.1073969566)),dot(rgb,vec3(.0883024619,.2817188376,.6299787005)));
 lms=pow(max(lms,vec3(0.)),vec3(1./3.));
 return vec3(dot(lms,vec3(.2104542553,.793617785,-.0040720468)),dot(lms,vec3(1.9779984951,-2.428592205,.4505937099)),dot(lms,vec3(.0259040371,.7827717662,-.808675766)));
}
vec3 rgb(vec3 lab){
 float l=lab.x+.3963377774*lab.y+.2158037573*lab.z;
 float m=lab.x-.1055613458*lab.y-.0638541728*lab.z;
 float s=lab.x-.0894841775*lab.y-1.291485548*lab.z;
 vec3 v=vec3(l*l*l,m*m*m,s*s*s);
 return vec3(dot(v,vec3(4.0767416621,-3.3077115913,.2309699292)),dot(v,vec3(-1.2684380046,2.6097574011,-.3413193965)),dot(v,vec3(-.0041960863,-.7034186147,1.707614701)));
}
void main(){
 vec4 source=texture2D(u_image,v_uv);vec3 original=linearize(source.rgb);vec3 o=lab(original);
 float c=length(o.yz);float hue=atan(o.z,o.y)+u_shift;float amount=smoothstep(.008,.036,c);
 float low=0.;float high=c*u_chroma;vec3 candidate=original;
 for(int i=0;i<12;i++){
  float mapped=(low+high)*.5;
  candidate=rgb(vec3(o.x,mapped*cos(hue),mapped*sin(hue)));
  if(min(min(candidate.r,candidate.g),candidate.b)>=0. && max(max(candidate.r,candidate.g),candidate.b)<=1.)low=mapped;else high=mapped;
 }
 candidate=rgb(vec3(o.x,low*cos(hue),low*sin(hue)));
 vec3 mixed=mix(original,clamp(candidate,0.,1.),amount);
 gl_FragColor=vec4(encode(mixed),source.a);
}`;

interface Gpu {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  shift: WebGLUniformLocation | null;
  chroma: WebGLUniformLocation | null;
}

let gpu: Gpu | undefined;

function initialize(): Gpu {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error("This browser has no WebGL, which the colors need. The original colors still work.");
  const shader = (kind: number, source: string) => {
    const s = gl.createShader(kind)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "Shader failed to compile");
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Shader failed to link");
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);
  return { canvas, gl, shift: gl.getUniformLocation(program, "u_shift"), chroma: gl.getUniformLocation(program, "u_chroma") };
}

const recolored = new WeakMap<HTMLImageElement, Map<PaletteId, HTMLCanvasElement>>();

/** The artwork in the palette's hue (cached per image and palette); the original image for the native palette. */
export function recolorArt(image: HTMLImageElement, palette: Palette, sourceHue: number): CanvasImageSource {
  if (palette.id === "native" || palette.hue === undefined) return image;
  let perImage = recolored.get(image);
  if (!perImage) recolored.set(image, (perImage = new Map()));
  const cached = perImage.get(palette.id);
  if (cached) return cached;
  gpu ??= initialize();
  if (gpu.gl.isContextLost()) gpu = initialize();
  const { canvas, gl, shift, chroma } = gpu;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.uniform1f(shift, ((palette.hue - sourceHue) * Math.PI) / 180);
  gl.uniform1f(chroma, palette.chroma ?? 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const result = document.createElement("canvas");
  result.width = canvas.width;
  result.height = canvas.height;
  result.getContext("2d")!.drawImage(canvas, 0, 0);
  perImage.set(palette.id, result);
  return result;
}
