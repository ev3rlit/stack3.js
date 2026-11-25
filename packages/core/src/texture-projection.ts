import type { MeshData } from './reconstruct'
import type { Raster } from './views'

export type TextureProjection = 'auto' | 'top-contour'
const clamp = (x: number) => Math.max(0, Math.min(1, x))

// Bucket upward-facing triangles in plan space. A centroid ray distinguishes
// the visible skin from upward-facing ledges inside an opening.
function visibleFromAbove(mesh: MeshData, bins: number) {
  const { positions: p, indices, size } = mesh
  const span = Math.max(size[0], size[1])
  const nx = Math.max(1, Math.round(bins * size[0] / span))
  const nz = Math.max(1, Math.round(bins * size[1] / span))
  const col = (x: number) => Math.min(nx-1, Math.floor(clamp(x / size[0]+.5)*nx))
  const row = (z: number) => Math.min(nz-1, Math.floor(clamp(z / size[1]+.5)*nz))
  const cells = Array.from({length:nx*nz}, ():number[]=>[])
  const visible = new Uint8Array(indices.length/3)
  for(let f=0; f<indices.length; f+=3){
    const a=indices[f]*3,b=indices[f+1]*3,c=indices[f+2]*3
    const up=(p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2])
    if(up<=0)continue
    visible[f/3]=1
    const x0=col(Math.min(p[a],p[b],p[c])),x1=col(Math.max(p[a],p[b],p[c]))
    const z0=row(Math.min(p[a+2],p[b+2],p[c+2])),z1=row(Math.max(p[a+2],p[b+2],p[c+2]))
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)cells[z*nx+x].push(f)
  }
  for(let f=0;f<indices.length;f+=3){
    if(!visible[f/3])continue
    const a=indices[f]*3,b=indices[f+1]*3,c=indices[f+2]*3
    const x=(p[a]+p[b]+p[c])/3,z=(p[a+2]+p[b+2]+p[c+2])/3,y=(p[a+1]+p[b+1]+p[c+1])/3
    for(const other of cells[row(z)*nx+col(x)]){
      if(other===f)continue
      const i=indices[other]*3,j=indices[other+1]*3,k=indices[other+2]*3
      const ux=p[j]-p[i],uz=p[j+2]-p[i+2],vx=p[k]-p[i],vz=p[k+2]-p[i+2]
      const det=ux*vz-uz*vx
      const u=((x-p[i])*vz-(z-p[i+2])*vx)/det, v=(ux*(z-p[i+2])-uz*(x-p[i]))/det
      if(u<0||v<0||u+v>1)continue
      const above=p[i+1]+u*(p[j+1]-p[i+1])+v*(p[k+1]-p[i+1])
      if(above>y+size[2]*1e-6){visible[f/3]=0;break}
    }
  }
  return visible
}

/** Apply TOP to the upper silhouette along the longest horizontal axis. The
 * original vertex ordering and elevation UVs are retained for all other faces. */
export function projectUpperContour(mesh: MeshData, plan: Raster, resolution: number, layers: number) {
  const { positions: p, normals, uvs, indices, texture, size } = mesh
  resolution = Math.max(1, Math.min(Math.max(plan.width, plan.height), Math.round(resolution) || 96))
  const visible=visibleFromAbove(mesh,resolution)
  const axis = size[1] >= size[0] ? 2 : 0
  const span = axis === 2 ? size[1] : size[0]
  const bin = (s: number) => Math.min(resolution - 1, Math.floor(clamp(s / span + 0.5) * resolution))
  const crest = new Float32Array(resolution).fill(-Infinity)
  for (let i = 0; i < p.length; i += 3) {
    const k = bin(p[i + axis])
    crest[k] = Math.max(crest[k], p[i + 1])
  }
  const depth = size[2] * Math.max(.10, 1.5 / layers)
  const used = new Map<number, number>()
  let triangles = 0
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f]*3, b = indices[f+1]*3, c = indices[f+2]*3
    const s = (p[a+axis]+p[b+axis]+p[c+axis])/3
    const nearCrest=(p[a+1]+p[b+1]+p[c+1])/3 >= crest[bin(s)]-depth
    const dx1=p[b]-p[a], dy1=p[b+1]-p[a+1], dz1=p[b+2]-p[a+2]
    const dx2=p[c]-p[a], dy2=p[c+1]-p[a+1], dz2=p[c+2]-p[a+2]
    const up=dz1*dx2-dx1*dz2
    const nx=Math.abs(dy1*dz2-dz1*dy2), nz=Math.abs(dx1*dy2-dy1*dx2)
    const riser = nearCrest && up===0 && Math.abs(s)<span*.46 && (axis===2 ? nz>nx : nx>nz)
    if (!visible[f/3] && !riser) continue
    triangles++
    for (let j=f;j<f+3;j++) {
      const old=indices[j]
      if (!used.has(old)) used.set(old,p.length/3+used.size)
      indices[j]=used.get(old)!
    }
  }
  if (!triangles) return 0
  // textureAtlas places TOP first, with a one-pixel gutter and 512px tile limit.
  const scale=Math.min(1,512/Math.max(plan.width,plan.height))
  const w=Math.max(1,Math.round(plan.width*scale)), h=Math.max(1,Math.round(plan.height*scale))
  for (let y=-1;y<=h;y++) {
    const yy=Math.min(h-1,Math.max(0,y))
    const row=Math.floor((yy+.5)*plan.height/h)*plan.width
    const texel=(x:number)=>(row+Math.floor((x+.5)*plan.width/w))*4
    let first=0,last=w-1
    while(first<=last && plan.data[texel(first)+3]<128) first++
    while(last>=first && plan.data[texel(last)+3]<128) last--
    if(first>last) continue
    for(let x=-1;x<=w;x++){
      if(x>=first && x<=last) continue
      const src=texel(x<first?first:last)
      texture.data.set(plan.data.subarray(src,src+3),((y+1)*texture.width+x+1)*4)
    }
  }
  const positions=new Float32Array(p.length+used.size*3), ns=new Float32Array(positions.length)
  const uv=new Float32Array(uvs.length+used.size*2)
  positions.set(p); ns.set(normals); uv.set(uvs)
  for(const [old,v] of used){
    positions.set(p.subarray(old*3,old*3+3),v*3)
    ns.set(normals.subarray(old*3,old*3+3),v*3)
    uv[v*2]=(1.5+clamp(p[old*3]/size[0]+.5)*(w-1))/texture.width
    uv[v*2+1]=(1.5+clamp(.5-p[old*3+2]/size[1])*(h-1))/texture.height
  }
  Object.assign(mesh,{positions,normals:ns,uvs:uv})
  return triangles
}
