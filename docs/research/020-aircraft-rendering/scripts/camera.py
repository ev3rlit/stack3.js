"""Register one weak-perspective camera to the original illustration, then freeze it."""
import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion
from scipy.optimize import least_squares, minimize
from common import ROOT, read_stack, save_json

# Trace outer landmarks including the pitot. A narrow GrabCut band refines the contour;
# the background mark in the lower right is outside the mask.
outline = [(143,614),(193,585),(239,563),(277,527),(327,487),(355,467),(397,424),
 (436,401),(454,385),(471,344),(497,335),(510,361),(548,344),(580,331),
 (612,275),(508,200),(510,192),(543,144),(560,140),(555,183),(739,236),
 (766,237),(811,140),(842,132),(846,212),(835,228),(878,219),(890,221),
 (900,234),(900,243),(923,246),(928,252),(954,248),(968,252),(978,263),
 (978,276),(1047,232),(1087,215),(1063,240),(983,318),(990,352),(1179,449),
 (1250,421),(1219,452),(1173,485),(1151,489),(860,409),(718,411),(685,434),
 (741,465),(713,482),(575,473),(532,480),(490,499),(443,519),(387,543),
 (300,562),(246,571),(197,593)]
photo = np.asarray(Image.open(ROOT/'inputs/reference.jpg').convert('RGB'))
height, width = photo.shape[:2]
rough = cv2.fillPoly(np.zeros((height,width),np.uint8),[np.array(outline)],1)
kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15))
grab = np.where(rough, cv2.GC_PR_FGD, cv2.GC_BGD).astype('uint8')
grab[(cv2.dilate(rough,kernel)>0)&(rough==0)] = cv2.GC_PR_BGD
grab[cv2.erode(rough,kernel)>0] = cv2.GC_FGD
cv2.setRNGSeed(19)
cv2.grabCut(photo[:,:,::-1].copy(),grab,None,np.zeros((1,65)),np.zeros((1,65)),4,cv2.GC_INIT_WITH_MASK)
mask = (grab%2).astype('uint8')
Image.fromarray(mask*255).save(ROOT/'inputs/reference-mask.png')

def basis(yaw,elev,roll):
    a,b,r = np.deg2rad([yaw,elev,roll])
    back = np.array([-np.sin(a)*np.cos(b), np.cos(a)*np.cos(b), np.sin(b)])
    right = np.array([-np.cos(a),-np.sin(a),0.])
    up = np.cross(back, right)
    return np.stack([np.cos(r)*right+np.sin(r)*up, -np.sin(r)*right+np.cos(r)*up, back])

def project(points, params):
    yaw,elev,roll,scale,cx,cy = params
    u,v,_ = basis(yaw,elev,roll)
    return np.column_stack((cx+scale*(points@u),cy-scale*(points@v)))

m,tiles = read_stack()
occ = tiles[...,3]>127
dims = np.array(occ.shape[::-1])
size = np.array(m['size'])
shift = np.array([-size[0]/2,-size[1]/2,0])
surface = np.argwhere(occ & ~binary_erosion(occ))[:,::-1]
points = (surface+.5)*size/dims+shift
# Initial pose from the needle, exhaust centers and upper winglet vertices.
world = np.array([[0,2.98,.61],[.29,-2.93,.60],[-.29,-2.93,.60],
                  [2.32,-2.54,.75],[-2.32,-2.54,.75]])
pixels = np.array([[144,614],[883,229],[961,257],[556,143],[1248,422]])
init = least_squares(lambda p:(project(world,p)-pixels).ravel(),
                     [45,25,0,170,620,420],bounds=([10,8,-30,90,450,220],[80,70,30,300,840,650])).x
# Splat boundary samples only for calibration. Final silhouettes use rendered triangles.
factor = .25
target = cv2.resize(mask,(round(width*factor),round(height*factor)),interpolation=cv2.INTER_AREA)>0
def score(params):
    xy = np.rint(project(points,params)*factor).astype(int)
    small = np.zeros(target.shape,'uint8')
    small[np.clip(xy[:,1],0,small.shape[0]-1),np.clip(xy[:,0],0,small.shape[1]-1)] = 1
    test = cv2.morphologyEx(small,cv2.MORPH_CLOSE,np.ones((3,3),'uint8')).astype(bool)
    return 1 - (target&test).sum()/(target|test).sum()
params = init
for width_step in (1.,.35):
    moves=np.array([2.,2.,1.2,4.,8.,6.])*width_step
    res = minimize(score,params,method='Nelder-Mead', options={
        'maxiter':320,'xatol':.02,'fatol':.00002,'initial_simplex':np.vstack([params,params+np.diag(moves)])})
    params=res.x
save_json(ROOT/'inputs/camera.json', dict(parameters=params.tolist(),basis=basis(*params[:3]).tolist(),
    resolution=[width,height], camera_model='orthographic', registration='single joint silhouette fit to the exposed voxel stack',
    initial_landmark_fit=init.tolist(), calibration_proxy_iou=1-score(params)))
print('camera',params,'calibration proxy',1-score(params))
