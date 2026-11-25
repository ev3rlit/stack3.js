# 스프라이트 스택에서 어떤 메시를 만들 것인가

같은 스택에서 시작해도 보존하려는 것이 다르면 적합한 메시가 달라진다. 날개에는 위치별 두께, 컵 손잡이에는 관통 구멍, 유리 덮개에는 연속적인 곡률, 픽셀 에셋에는 정확한 셀 경계가 중요하다. 아래 표는 각 기법의 입력, 이점, 실패하기 쉬운 조건을 함께 정리한다. 부품별 추천은 문헌과 이 저장소의 입력 조건을 종합한 판단이다.

## stack3에서 지금 출발하는 지점

**피사체 → 부품별 4면 아틀라스 → 저장된 스프라이트 스택 → 부품별 메시 추출 → Blender 검토·마감** 순서를 기준으로 한다. 현재 `stack3 mesh`는 `stack.json`의 크기·층 간격과 `stack.png`의 알파 128 이상을 사용한다. RGB는 표면색에 쓰인다. 따라서 캐노피처럼 투명한 재질도 **형상 점유 마스크**와 **렌더용 투명도**를 구별해야 한다. 현행 추출기는 Marching Cubes, Surface Nets, 노출 복셀 면의 세 종류다. CLI의 `build --mesh-method contour`는 아틀라스를 직접 읽는 별도 경로다. [스킬의 선택표](../../../skills/stack3/SKILL.md) · [입력과 메서드 분기](../../../packages/core/src/reconstruct.ts) · [표면 추출 구현](../../../packages/core/src/surface.ts)

**부위별 단면 가이드**는 특정 위치의 폭·두께·안쪽 윤곽처럼 지켜야 할 형상 조건을 준다. 가이드로 스택을 수정하고 Marching Cubes를 실행할 수도 있고, 스택에서 읽은 단면을 가이드로 보정해 로프트할 수도 있다. 실제 저장소의 통제 비교에서는 추출기를 Marching Cubes로 고정하고 가이드만 바꿨다. 사선 사진 실루엣 IoU는 70.93%에서 72.65%로 상승했고, 입력 4면 평균 IoU는 88.68%에서 77.64%로 하락했다. 어느 기준을 더 잘 따르게 되었는지 함께 봐야 한다. [이전 실험과 단면 확대](../020-aircraft-rendering/guide-comparison/README.md)

### 1. 저장된 격자에서 경계면을 추출하는 방법

| 기법 | 무엇을 바꾸는가 | stack3에서 적합한 경우와 한계 |
| --- | --- | --- |
| 노출 복셀 면 · Greedy Meshing | 인접한 빈 셀과의 경계에 사각형을 만들고, Greedy는 같은 평면·방향의 사각형을 직사각형으로 합친다. | 현행 `voxel`을 기준으로 블록 형태를 유지하며 면 수를 줄일 때 유력하다. 재질 경계, UV 재투영, 긴 변 중간에 다른 면의 꼭짓점이 닿는 T 접합을 검사한다. [원저자의 알고리즘과 예시](https://0fps.net/2012/07/07/meshing-minecraft-part-2/) |
| Monotone Meshing | 같은 평면의 셀 영역을 단조 다각형으로 분할한 뒤 삼각화한다. | 계단식 실루엣을 유지한다. Greedy와 삼각형 수·공유 정점 수가 다르므로 엔진 업로드 후 비교할 가치가 있다. [구현 비교](https://0fps.net/2012/07/07/meshing-minecraft-part-2/) |
| Marching Cubes · 위상 보정형 MC | MC는 각 셀 모서리의 등값 교차점을 잇는다. Asymptotic Decider는 면의 모호한 연결을 판정하고, MC33 계열은 셀 내부의 경우도 다룬다. | 손잡이 구멍이나 대각선으로 접하는 셀에 적합한 비교 후보. 보장 대상은 선택한 보간장의 위상이다. 스택에 이미 막혀 있는 구멍에는 별도 단면 증거가 필요하다. 구현별 예외도 있다. [CGAL 설명](https://doc.cgal.org/6.2/Isosurfacing_3/index.html) · [MC33 보정 연구](https://www.sci.utah.edu/~etiene/pdf/mc33.pdf) |
| Marching Tetrahedra | 육면체를 사면체로 나누고 각 사면체 안에서 선형 등면을 추출한다. | 셀 안 보간이 단순하다. 사면체 분할 방향이 표면에 나타날 수 있고 삼각형이 많이 생긴다. 아래 실측 참조. [기법 설명](https://davc.hpc.mil/gettingStarted/Marching_Tetrahedra.html) |
| 기본 Surface Nets · 제약 평활화 Surface Nets | 경계 셀마다 대표점을 두고 인접 셀을 잇는다. 제약형은 허용 범위 안에서 표면을 반복 평활화할 수 있다. | 캐노피, 돌, 둥근 외장에 비교한다. 얇은 끝과 주름 능선의 수축을 확인한다. 현행 stack3의 교차점 평균과 VTK의 반복 평활화는 설정이 다르다. [stack3 구현](../../../packages/core/src/surface.ts) · [VTK 구현](https://vtk.org/doc/nightly/html/classvtkSurfaceNets3D.html) |
| Extended Marching Cubes | 교차점과 법선으로 한 셀 안의 날·코너를 추정해 정점을 추가한다. | 각진 손잡이, 하우징 모서리가 후보. 이진 계단에서 계산한 법선은 거짓 모서리도 강화할 수 있다. [Kobbelt 외 원 논문](https://graphics.stanford.edu/courses/cs164-10-spring/Handouts/paper_p57-kobbelt.pdf) |
| Hermite Dual Contouring | 경계 교차점과 법선이 만드는 평면들에 가장 잘 맞는 대표점을 구한다. 오차 최소화에 QEF를 사용한다. | 날카로운 접힘과 평면 교차를 살릴 때 유망하다. 법선 품질, 정점이 셀 밖으로 나가는 경우, 한 셀에 여러 표면이 드는 경우를 검사한다. [Ju 외 원 논문](https://www.cs.rice.edu/~jwarren/papers/dualcontour.pdf) |
| Manifold Dual Contouring | 세분화된 격자의 표면 연결을 고려하며 대표점을 병합해 매니폴드 표면을 구성한다. | 가까이 있는 두 겹이나 작은 통로를 유지하며 단순화하는 후보. 필요한 초기 표본이 있는지와 병합 기준이 중요하다. [Schaefer 외 원 논문](https://profiles.wustl.edu/en/publications/manifold-dual-contouring/) |
| Dual Marching Cubes | 옥트리 등에서 쌍대 격자를 구성하고 그 격자 위에 등면을 만든다. | 얇은 돌출부에 적응적으로 표본을 배치할 수 있을 때 유용하다. 균일한 PNG 스택에서 시작하면 적응 격자 구성과 보간을 추가해야 한다. [Schaefer·Warren 원 논문](https://www.cs.rice.edu/~jwarren/papers/dmc.pdf) |
| Occupancy-Based Dual Contouring | 임의 위치에서 안·밖을 질의할 수 있는 점유 함수를 더 촘촘히 탐색해 경계와 특징을 구한다. 학습이 필요 없는 방식이다. | 고해상도 연속 점유 함수를 보유할 때 유력하다. 기존 PNG의 0/1에서 만든 함수라면 추가 질의 결과도 보간 가정에 의존한다. [Hwang·Sung 원 논문](https://arxiv.org/abs/2409.13418) |
| 다중 라벨 Surface Nets · Discrete Marching Cubes | 정수 라벨 볼륨에서 재료·영역 사이 경계를 구성한다. 다중 라벨 Surface Nets는 인접 영역이 공유하는 경계면을 표현한다. | 해부 모형, 단층 지형처럼 영역이 실제로 경계를 공유할 때 적합하다. 독립 피벗이 있는 조립 파츠에는 별도 스택과 마운트가 더 직접적이다. RGB 색을 임의로 부품 ID로 쓰면 도색선도 경계가 된다. [VTK Surface Nets](https://vtk.org/doc/nightly/html/classvtkSurfaceNets3D.html) · [VTK Discrete MC](https://vtk.org/doc/nightly/html/classvtkDiscreteMarchingCubes.html) |
| Delaunay refinement | 영역의 내부·경계 판정을 반복해 표면 삼각형과 내부 사면체를 오차·크기 조건에 맞춘다. | 다중 영역의 내부까지 필요한 해석용 모델에 유리하다. 화면에 보일 외피만 내보낼 때는 내부 격자 생성 비용을 따로 평가한다. [CGAL Mesh_3](https://doc.cgal.org/6.1/Mesh_3/index.html) |

**처리량과 메모리**가 목표일 때는 VTK Flying Edges가 균일 격자를 여러 패스로 순회해 등면을 만들고, OpenVDB VolumeToMesh는 희소 볼륨과 적응적 폴리곤 생성을 제공한다. 128층 이상의 큰 빈 공간이 있는 자산이라면 변환 시간·최대 메모리·최종 오차를 함께 측정할 후보다. 어느 쪽도 원본 이미지 해상도를 높이지는 않는다. [VTK Flying Edges](https://vtk.org/doc/nightly/html/classvtkFlyingEdges3D.html) · [OpenVDB VolumeToMesh](https://www.openvdb.org/documentation/doxygen/VolumeToMesh_8h_source.html)

### 2. 단면을 직접 연결하거나 부품의 형태를 이용하는 방법

여기서 단면은 해당 위치의 **절단선**이다. 정면·측면에서 본 외곽선은 여러 깊이의 표면이 겹쳐 생긴 **투영 실루엣**이다. 실루엣을 임의 위치의 절단선으로 간주하면 돔이 둥근 상자처럼 되거나 날개 끝이 두꺼워질 수 있다. 스택에서 얻은 절단선, 아틀라스에서 읽은 외곽, 사람이 지정한 형상 가정을 구분해 기록한다.

| 기법 | 어떻게 형상을 만드는가 | 추천 대상과 확인할 것 |
| --- | --- | --- |
| 단면 링 브리지 · Ruled Surface | 이웃 단면의 대응점을 직선으로 연결한다. 실제 스택 단면을 직접 비교하기 쉽다. | 얇은 판, 길게 뻗은 케이스. 시작점·진행 방향·특징점 대응이 틀리면 면이 비틀린다. [VTK Ruled Surface](https://vtk.org/doc/nightly/html/classvtkRuledSurfaceFilter.html) |
| 최소비용 단면 삼각화 | 이웃 폐곡선을 연결하는 삼각형 띠 중 정의한 비용이 작은 띠를 찾는다. | 층마다 윤곽 정점 수가 다를 때 유용하다. 비용과 꼭짓점 시작 위치에 따라 특징점이 밀릴 수 있다. [Fuchs·Kedem·Uselton](https://www.cs.jhu.edu/~misha/Fall13b/Papers/Fuchs77.pdf) |
| 분기 대응 contour stitching | 한 개의 윤곽이 두 개로 나뉘고 다시 합쳐지는 구간에서 연결 관계를 정한 뒤 면을 잇는다. | 컵 손잡이, 나뭇가지, Y자 배관. 구멍의 시작·끝과 연결 성분 수가 달라지는 층을 먼저 표시한다. [Meyers의 분기 연구](https://graphicsinterface.org/wp-content/uploads/gi1991-32.pdf) |
| Straight-skeleton 단면 보간 | 단면 다각형 사이에 직선 골격을 이용해 조각별 선형 표면을 만든다. | 평면과 각이 중요한 다각형 단면. 작은 톱니가 골격 분기로 증폭되는지 본다. [Barequet 외 원 논문](https://www.cs.jhu.edu/~misha/Fall13b/Papers/Barequet04.pdf) |
| 거리장 기반 단면 보간 | 각 층 윤곽을 2D 부호 거리로 바꾸고 중간 거리장을 보간한 뒤 등면을 추출한다. | 단면 수가 제한적이고 대응점을 직접 맞추기 어려울 때 유용하다. 층 사이에서 크게 이동하는 가는 부품이 끊기거나 인접한 고리가 붙을 수 있다. [Raya·Udupa 원 논문](https://pubmed.ncbi.nlm.nih.gov/18222748/) |
| 부드러운 단면 로프트 | 여러 단면을 통과하도록 곡면을 맞춘 뒤 삼각화한다. 끝·중간에 두께 가이드를 줄 수 있다. | 캐노피, 병, 유선형 몸통. 단면 사이가 부풀거나 꼭짓점에서 비틀리지 않는지 중간 단면으로 검사한다. [Open CASCADE의 Through Sections](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) |
| 비평행 단면 곡선망 재구성 | 서로 다른 방향의 평면에 그려진 단면 곡선을 동일 좌표계에서 결합한다. | **수직+수평 가이드**를 활용할 가장 직접적인 후보. 서로 독립적으로 확인한 절단선은 두께와 오목부를 제약한다. 같은 스택을 재절단한 두 묶음은 방향별 점검용으로 쓸 수 있다. 두 단면이 만나는 선에서 안·밖 판정이 일치해야 한다. [Liu 외 원 논문](https://www.cs.wustl.edu/~taoju/research/eg_paper_final.pdf) |
| 윤곽 돌출 · 상하 높이장 | 돌출은 평면 윤곽에 깊이를 준다. 두께가 변하는 판은 각 평면 위치에서 스택의 첫·마지막 점유 높이로 두 표면을 만들고 테두리를 닫을 수 있다. | 표지판엔 돌출, 매끈하게 변하는 얇은 판에는 상하 높이장이 후보. 한 열에 두 개 이상의 점유 구간이 있으면 사이 빈 공간이 메워지므로 다른 방법을 택한다. 높이장 쌍은 이 연구의 stack3 적용 제안이다. [돌출의 공식 구현](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) |
| 축 회전 · 경로 스윕 | 회전은 단면을 축 둘레로 돌리고, 스윕은 단면을 중심선을 따라 이동시킨다. | 축대칭인 병·바퀴에는 회전, 굽은 손잡이·케이블에는 스윕. 비대칭 돌기, 스윕 단면의 회전, 급한 굴곡의 자기 교차를 검사한다. [Open CASCADE의 Revolution·Pipe](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) |
| 평면 패치 조립 · PolyFit | 점군에서 평면 후보를 찾고 경계가 닫히도록 다각형 면의 조합을 선택한다. | 건물·상자·판금 외장. 스택 표면점으로 시도할 수 있으나, 원래 곡면인 부분이 많은 자산은 평면으로 쪼개진다. [CGAL Polygonal Surface Reconstruction](https://doc.cgal.org/latest/Polygonal_surface_reconstruction/index.html) |

### 3. 점군·거리장·학습 모델을 추가로 쓰는 방법

스택 외피를 점군으로 표본화해 아래 기법 일부를 실행할 수 있다. 같은 셀에서 얻은 점과 법선은 원본의 계단·누락도 물려받는다. 스캔 점군, 보정된 깊이 이미지, 독립 단면처럼 실제 추가 관측이 있을 때 비용 대비 이점이 커진다.

| 기법 | 필요한 입력 | 잘 맞는 문제와 주요 한계 |
| --- | --- | --- |
| Alpha Shapes | 3D 점군과 스케일 매개변수 | 점 사이 거리로 세부 구조의 연결 수준을 조절한다. 밀도 편차가 크면 한 값으로 서로 다른 두께와 구멍을 살리기 어렵다. [Open3D 비교](https://www.open3d.org/docs/release/tutorial/geometry/surface_reconstruction.html) |
| Ball Pivoting | 법선이 있는 점군, 공 반지름 하나 이상 | 공이 점 세 개에 닿으며 표면을 전개한다. 촘촘한 스캔에 유리하고 듬성한 구간에는 구멍이 남을 수 있다. [Open3D 구현](https://www.open3d.org/docs/release/tutorial/geometry/surface_reconstruction.html) |
| Advancing Front | 비정렬 점군 | 적합한 삼각형부터 표면 경계를 확장한다. 경계가 있는 표면을 만들 수 있고, 표본 간격이 달라지는 곳에서 연결이 달라진다. [CGAL 설명](https://doc.cgal.org/latest/Advancing_front_surface_reconstruction/index.html) |
| Scale-Space Reconstruction | 잡음 있는 점군 | 평활화한 점들에서 연결을 구하고 원래 점 위치로 옮길 수 있다. 얇은 두 겹 사이가 합쳐지는지 검사한다. [CGAL 설명](https://doc.cgal.org/latest/Scale_space_reconstruction_3/index.html) |
| Poisson · Screened Poisson | 일관되게 향한 표면 법선과 점군 | 유기체나 둥근 스캔을 매끈한 암시적 표면으로 만든다. Screened 변형은 표본 위치에 더 잘 맞도록 항을 추가한다. 관측 공백까지 표면이 이어질 수 있어 입구·열린 천에는 주의한다. [Kazhdan·Hoppe 원 논문](https://www.cs.jhu.edu/~misha/Fall13b/Papers/Kazhdan13.pdf) |
| Alpha Wrapping | 점군이나 연결이 불량한 삼각형 모음, 허용 스케일·오프셋 | 입력을 감싸는 닫힌 외피가 필요할 때 쓴다. 충돌용 단순 외피에 유력하며 좁은 틈과 오목부가 닫힐 수 있다. Alpha Shapes와 다른 연산이다. [CGAL 설명](https://doc.cgal.org/latest/Alpha_wrap_3/index.html) |
| TSDF 융합 + 등면 추출 | 보정된 카메라, 깊이 이미지, 자세 | 여러 측정 깊이를 하나의 거리장으로 합친 뒤 표면을 뽑는다. 일반 RGB 정투상 아틀라스에는 측정 깊이가 없다. 스택에서 만든 거리장은 별도 실험 조건으로 취급한다. [Open3D RGB-D Integration](https://www.open3d.org/docs/latest/tutorial/pipelines/rgbd_integration.html) |
| Neural Marching Cubes · Neural Dual Contouring | 학습 가중치 및 모델이 지원하는 표현의 격자·점군 | 셀 연결이나 정점 위치를 학습해 예측한다. 변형마다 지원 입력이 다르고, 훈련 데이터와 다른 형태의 1셀 돌출부·구멍은 별도 검증이 필요하다. [NMC](https://arxiv.org/abs/2106.11272) · [NDC](https://arxiv.org/abs/2202.01999) |
| DMTet · FlexiCubes | 최적화할 격자·거리값과 기준 형상 또는 영상 손실 | DMTet은 변형 가능한 사면체 격자에서, FlexiCubes는 국소 표면 추출 매개변수까지 조절하며 오차를 역전파할 수 있다. 여러 시점에 맞추는 최적화가 목적일 때 후보다. 한 시점에 잘 맞더라도 다른 방향의 두께를 확인해야 한다. [DMTet](https://research.nvidia.com/labs/toronto-ai/DMTet/assets/dmtet.pdf) · [FlexiCubes](https://research.nvidia.com/labs/toronto-ai/flexicubes/) |
| DualMesh-UDF | 연속적인 무부호 거리장과 그 미분 정보 | 천·잎처럼 안팎이 정의되기 어려운 열린 표면에 유리하다. 두꺼운 점유 마스크를 단순 이진화한 결과로 원래 중심면을 특정하기는 어렵다. [Zhang 외 원 논문](https://openaccess.thecvf.com/content/ICCV2023/papers/Zhang_Surface_Extraction_from_Neural_Unsigned_Distance_Fields_ICCV_2023_paper.pdf) |

### 4. 이미 만든 메시를 정리하는 선택지

| 목표 | 기법 | 검토 기준 |
| --- | --- | --- |
| 삼각형 예산 맞추기 | QEM edge collapse로 평면 근사 오차가 작은 변부터 축약한다. | 구멍 테두리·재질 경계·작은 돌출부와 UV를 보호하고, 같은 삼각형 예산에서 원본에 대한 오차를 잰다. [Garland·Heckbert](https://www.cs.cmu.edu/~garland/Papers/quadrics.pdf) |
| 긴 삼각형과 불균일한 밀도 줄이기 | 등방성 리메싱으로 변 분할·축약·뒤집기와 정점 이동을 조합한다. | 날카로운 특징선을 제약하고 얇은 반대쪽 면으로 정점이 재투영되는지 확인한다. [CGAL Remeshing](https://doc.cgal.org/latest/PMP_Remeshing/) |
| 편집하기 좋은 사각형 흐름 만들기 | Instant Meshes가 방향장을 따라 쿼드 위주로 표면을 다시 나눈다. | Blender에서 편집할 캐노피나 외장 후보. 관절 변형용 루프와 UV 이음선은 별도로 검토한다. [Instant Meshes 프로젝트](https://igl.ethz.ch/projects/instant-meshes/) |
| 서로 다른 해상도의 볼륨 메시 연결 | Transvoxel이 서로 이웃한 두 해상도 사이에 전이 셀을 구성한다. | 덩어리별 LOD를 쓰는 지형에서 균열 방지용이다. 단일 소형 파츠의 실루엣 개선과는 목적이 다르다. [원저자 자료](https://transvoxel.org/) |

## 실제 부품 스택 두 개에서 확인한 차이

저장소에 있는 **카나드(앞날개) 93×110×30셀**과 **캐노피 38×150×40셀**을 그대로 사용했다. 새 파츠를 모델링하거나 아틀라스를 다시 생성하지 않았다. 각 부품 안에서 입력 알파, 축별 실제 셀 간격과 외부 빈 셀 패딩을 고정했다. Flying Edges와 사면체 방식은 같은 0/1 표본에 등값 0.5를 적용했다. 현행 stack3 CLI의 전처리까지 포함한 성능 측정과는 조건이 다르다. [원본 부품](../020-aircraft-rendering/part-atlases/README.md) · [재현 스크립트](compare.py)

| 추출 방식 | 카나드 삼각형 | 캐노피 삼각형 | 카나드 / 캐노피의 점유 체적 IoU |
| --- | ---: | ---: | --- |
| 노출 셀 면을 각각 삼각화 | 34,908 | 39,828 | 두 부품 모두 100%¹ |
| 같은 방향의 면을 Greedy로 묶어 삼각화 | 1,516 | 6,064 | 두 부품 모두 100%¹ |
| VTK Flying Edges | 34,904 | 39,824 | 99.050% / 99.050%² |
| 사면체 분할 후 VTK 등면 추출 | 97,080 | 106,532 | 99.342% / 99.289%² |

¹ 두 블록 방식은 같은 평면 위의 같은 셀 면을 덮는다. 스크립트는 노출 면과 병합 직사각형을 세고 각각 2삼각형으로 환산했다. 100%는 구성상 일치하는 값이다. 재질·UV에 따른 추가 분할은 제외했다.

² 추출한 메시를 축마다 셀당 3번, 셀당 총 27곳에서 독립적으로 다시 점유 판정했다. 스택과 메시가 함께 차지하는 부피를 둘 중 하나라도 차지하는 부피로 나눈 값이다. 실제 피사체의 알려지지 않은 3D 형상이나 렌더 외관의 정확도를 나타내지는 않는다.

카나드에서 Greedy의 감소율은 **95.7%**, 캐노피에서는 **84.8%**였다. 평평한 면이 길게 이어지는 정도가 다른 부품에서 얻은 결과다. 사면체 방식은 Flying Edges보다 각각 **2.78배, 2.68배**의 삼각형을 써서 점유 체적 IoU를 **0.292%p, 0.239%p** 높였다. 이 수치만으로 날개가 더 얇고 자연스러워졌는지는 판단할 수 없다. 기법별 납품 화질 비교에는 원본 사진과 단면 오차, 같은 예산의 후처리본이 필요하다.

재현은 저장소 루트에서 [기존 연구 환경](../020-aircraft-rendering/requirements.txt)의 Python으로 실행한다.

```sh
python docs/research/030-meshing-methods/compare.py
```

## stack3에 먼저 적용해 볼 순서

| 우선 대상 | 첫 비교 | 채택 여부를 가를 관찰 |
| --- | --- | --- |
| 날개·지느러미·얇은 칼라 | 같은 스택에서 기본 MC와 **두께를 제약한 단면 로프트**를 비교한다. 돌출 방향마다 점유 구간이 하나면 상하 높이장도 포함한다. | 뿌리·중간·끝의 같은 위치에서 두께를 재고, 가장 얇은 끝이 끊기는지 본다. 단면 사이의 중간점도 측정해 부풀어 오른 보간을 잡는다. |
| 캐노피·병·둥근 포장 | 기존 Surface Nets와 부드러운 로프트를 비교한다. 회전대칭인 몸통에는 축 회전도 포함한다. | 같은 무광 재질의 근접 사선과 측면에서 윤곽 오차를 재고, 같은 유광 재질에서 하이라이트가 단면 사이에서 꺾이는지 확인한다. |
| 하드서피스 외장·가전 모서리 | 신뢰할 수 있는 경계 법선이나 지정한 특징선이 있을 때 Extended MC와 Hermite Dual Contouring을 비교한다. | 실제 모서리의 둥글어짐과 원래 매끈한 면에 생긴 거짓 능선을 함께 검사한다. |
| 머그 손잡이·배관·관통구 | 입력 스택의 구멍부터 확인한다. 열려 있으면 위상 보정형 MC, 윤곽 수가 변하면 분기 대응, 독립적인 가로·세로 절단선이 있으면 비평행 단면 기법을 비교한다. | 입구부터 출구까지의 빈 공간 연결과 가장 좁은 목의 폭을 잰다. 입구가 보이는 사선만으로는 중간 막힘을 잡을 수 없다. |
| 블록 스타일·격자 기준 모델 | 노출 복셀 면과 Greedy를 비교한다. | 셀 경계·색 경계를 유지하며 실제 GLB의 삼각형·정점·바이트가 얼마나 줄었는지 확인한다. |
| 나뭇잎·천처럼 열린 표면 | 두께가 명시되지 않은 경우 단면/경계 곡선으로 만든 얇은 시트와, UDF가 제공될 경우 UDF 추출 결과를 비교한다. | 앞뒤 두 겹이 붙거나 테두리가 막히지 않는지 확인한다. 재질의 양면 표시도 점검한다. |

비교할 때는 먼저 **가이드를 고정하고 추출기만** 바꾼다. 다음에는 **추출기를 고정하고 가이드만** 바꾼다. Blender에서 같은 카메라·조명·재질로 목표 화면 크기와 근접 단면을 함께 확인한다. 후보별로 원본 메시와 동일 삼각형 예산의 메시를 각각 남기면 형상 개선과 폴리곤 절감 효과를 독립적으로 판단할 수 있다.
