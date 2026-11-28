"""Compare cross sections cut through occupancy cells and exported triangles."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
import numpy as np
from pathlib import Path
from measure import geometry
from sections import read_stack


def voxel_cut(ax, folder, z, color):
    meta, rgba = read_stack(Path(folder))
    sx,sy,sz=meta["size"]
    ix=int(z/sz*meta["layers"])
    mask=rgba[:,:,ix,3]>=128
    dx,dy=sx/mask.shape[0],sy/mask.shape[1]
    edges=[]
    for x,y in np.argwhere(mask):
        for nx,ny,p,q in [(x-1,y,(x,y),(x,y+1)),(x+1,y,(x+1,y),(x+1,y+1)),
                          (x,y-1,(x,y),(x+1,y)),(x,y+1,(x,y+1),(x+1,y+1))]:
            if nx<0 or ny<0 or nx>=mask.shape[0] or ny>=mask.shape[1] or not mask[nx,ny]:
                edges.append([p,q])
    seg=np.asarray(edges)*[dx,dy]-[sx/2,sy/2]
    ax.add_collection(LineCollection(seg,colors=color,linewidths=1.25))


def mesh_cut(ax,name,z,color):
    v,f=geometry(Path(name+".glb"))
    tri=v[f]; ys=tri[:,:,1]
    overlap=(ys.min(axis=1)<z)&(ys.max(axis=1)>=z)
    p=tri[overlap]; q=np.roll(p,-1,axis=1)
    use=(p[:,:,1]<z)!=(q[:,:,1]<z)
    a=p[use]; b=q[use]
    hits=a+(b-a)*((z-a[:,1])/(b[:,1]-a[:,1]))[:,None]
    ends=hits[:,[0,2]]*[1,-1]
    ax.add_collection(LineCollection(ends.reshape(-1,2,2),colors=color,linewidths=1.8))


fig,axes=plt.subplots(2,3,figsize=(10,6.6))
palette=["#a6acaf","#383c43","#c64e21","#008478"]
for col,z in enumerate([.31,.56,.72]):
    top,bot=axes[:,col]
    top.set_title(f"Height {z:.2f}",fontsize=13)
    voxel_cut(top,"hull-control",z,palette[0])
    voxel_cut(top,"../layer-count/stack-32-64",z,palette[1])
    mesh_cut(bot,"A",z,palette[1])
    mesh_cut(bot,"G-lod",z,palette[2])
    mesh_cut(bot,"L-lod",z,palette[3])
    for ax in (top,bot):
        ax.set(xlim=(-.47,.47),ylim=(.47,-.47),aspect="equal",xticks=[],yticks=[])
        for spine in ax.spines.values():spine.set_color("#dddddd")
axes[0,0].set_ylabel("Carved stack",fontsize=12)
axes[1,0].set_ylabel("Finished mesh",fontsize=12)
labels=["Silhouette hull","Round stack / baseline","Width-based loft","Contour loft"]
fig.legend([Line2D([],[],lw=2,color=c) for c in palette],labels,loc="lower center",ncol=4,frameon=False)
fig.tight_layout(rect=(0,.06,1,1))
fig.savefig("cross-sections.png",dpi=150)
