"""Loft the upper and lower bill using the open intervals of the side silhouette."""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d
from scipy.interpolate import PchipInterpolator
from fit_lobes import ROOT, blend, save_field

folder=ROOT/'beak'
top=np.asarray(Image.open(folder/'top.png'))[...,3]>=128
side=np.asarray(Image.open(folder/'left.png'))[...,3]>=128
stations=(np.arange(80)+.5)/80
samples=[]
for y in stations:
    cols=np.flatnonzero(top[min(len(top)-1,int(y*len(top)))])
    z=side[::-1,min(side.shape[1]-1,int((1-y)*side.shape[1]))]
    d=np.diff(np.r_[False,z,False].astype(int))
    lo,hi=np.where(d==1)[0]/len(z),np.where(d==-1)[0]/len(z)
    low,high=lo[0],hi[-1]
    if len(lo)>1:
        mouth=(hi[0]+lo[-1])/2
        gap=lo[-1]-hi[0]
    else:
        mouth=np.clip(.466,low+.25*(high-low),high-.25*(high-low))
        gap=0
    samples.append([cols.mean()/top.shape[1],(cols[-1]-cols[0]+1)/(2*top.shape[1]),low,high,mouth,gap])
samples=gaussian_filter1d(np.array(samples),.65,axis=0,mode='nearest')
n=80;extra=.125
t=(np.arange(n+2)-.5)/n*(1+2*extra)-extra
q=np.clip(t,stations[0],stations[-1])
cx,r,low,high,mouth,gap=PchipInterpolator(stations,samples,axis=0)(q).T
x=t[:,None,None];z=t[None,None,:]
def oval(lower,upper,width):
    mid=(upper+lower)/2
    half=np.maximum((upper-lower)/2,.001)
    radial=np.sqrt(((x-cx[None,:,None])/width[None,:,None])**2+((z-mid[None,:,None])/half[None,:,None])**2)
    return (radial-1)*np.minimum(width,half)[None,:,None]
upper=oval(mouth+gap*.5,high,r)
lower=oval(low,mouth-gap*.5,r*.92)
pair=blend(upper,lower,.009)
w=np.clip((t-.30)/.48,0,1)
w=w*w*(3-2*w)
field=pair*w[None,:,None]+oval(low,high,r)*(1-w[None,:,None])
field=-blend(-field,np.minimum(t,1-t)[None,:,None],.020)
save_field(folder,field,extra)
