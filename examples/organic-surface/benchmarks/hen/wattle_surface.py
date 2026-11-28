"""Two rounded bulbs with a common upper attachment, lofted from FRONT and LEFT."""
import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import gaussian_filter1d


def intervals(row):
    changes=np.diff(np.r_[False,row,False].astype(int))
    return np.column_stack((np.flatnonzero(changes==1),np.flatnonzero(changes==-1)))/len(row)


def field(images,t):
    front=images['front'][::-1,:,3]>127
    side=images['left'][::-1,::-1,3]>127
    stations=(np.arange(80)+.5)/80
    sections=[]
    for z in stations:
        spans=intervals(front[int(z*len(front))])
        ya,yb=intervals(side[int(z*len(side))])[[0,-1],[0,1]]
        if len(spans)>1:
            left,right=spans[0],spans[-1]
        else:
            lo,hi=spans[0];mid=(lo+hi)/2
            overlap=.105*(hi-lo)*np.clip((z-.18)/.25,0,1)
            left,right=(lo,mid+overlap),(mid-overlap,hi)
        sections.append([np.mean(left),np.diff(left).item()/2,np.mean(right),np.diff(right).item()/2,(ya+yb)/2,(yb-ya)/2])
    profiles=np.array(sections).T
    def section(line,radius=False):
        q=np.clip(t,0,1)
        if radius:
            r2=gaussian_filter1d(line**2,.9,mode='nearest')
            return np.sqrt(np.maximum(1e-10,PchipInterpolator(np.r_[0,stations,1],np.r_[0,r2,0])(q)))
        return np.interp(q,stations,gaussian_filter1d(line,.85,mode='nearest'))
    cy=section(profiles[4]); ry=section(profiles[5],True)
    x,y=t[:,None,None],t[None,:,None]
    bulbs=[]
    for i in (0,2):
        cx=section(profiles[i]);rx=section(profiles[i+1],True)
        dx=x-cx;dy=y-cy
        surface=(np.hypot(dx/rx,dy/ry)-1)*np.minimum(rx,ry)
        cap=np.sqrt(dx**2+dy**2+(t-np.clip(t,0,1))**2)
        bulbs.append(np.where((t>0)&(t<1),surface,cap))
    a,b=bulbs
    return np.minimum(a,b)-np.maximum(.013-np.abs(a-b),0)**2/(4*.013)
