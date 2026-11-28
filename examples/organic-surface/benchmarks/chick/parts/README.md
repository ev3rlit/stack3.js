# 병아리 파츠 분리 벤치마크

[최신 텍스처 렌더](textured/hero.png) · [정면](textured/front.png) · [측면](textured/side.png) · [눈·텍스처 포함 GLB](textured/chick-textured.glb) · [조명과 카메라가 포함된 Blender 파일](textured/chick-studio.blend) · [벼슬 수정 전후](crest/left-comparison.jpg) · [최신 제작 기록](textured/README.md)

[무채색 조립 GLB](chick-separated.glb) · [360도 조립·분해 비교](chick-parts-turntable.mp4) · [등록된 파츠 아틀라스](part-atlases.jpg) · [원래 병아리 4뷰](../chick-4view.png) · [형상 검사](geometry-checks.json) · [윤곽 측정](measurements.json)

| 고유 파츠 | 수량 | 개당 삼각형 | 독립 아틀라스 |
|---|---:|---:|---|
| 몸통 | 1 | 480 | [4뷰](body/source.png) |
| 날개 | 2 | 128 | [4뷰](wing/source.png) |
| 벼슬 · 깃털 두 개 한 묶음 | 1 | 220 | [4뷰](crest/source.png) |
| 부리 · 위아래 한 묶음 | 1 | 164 | [4뷰](beak/source.png) |
| 다리 · 발 포함 | 2 | 240 | [4뷰](leg/source.png) |

기존 단일 메시와 조립본은 각각 1,600개 삼각형이다. 조립 GLB에는 몸통과 여섯 개의 부착물이 개별 메시 노드로 들어 있다. 좌우 날개와 다리는 같은 형상을 반사하고 면 방향을 바로잡아 배치했다. 눈을 제외하고 한 가지 무채색 재질로 내보냈다.

원본 병아리 4뷰를 기준으로 내장 ImageGen이 독립 파츠 4뷰 다섯 장을 생성했다. [생성 프롬프트](image-prompts.json)에 각 파츠의 지시문이 있다. 날개 TOP은 앞쪽이 왼쪽에 그려져 패널을 반시계 방향으로 90도 등록했다. 전체 아틀라스에서 가려진 부착면과 두께는 추정값이다. 별도의 독립 깊이 측정값은 사용하지 않았다.

몸통은 높이별, 날개는 길이별로 두 직교 마스크에서 폭과 중심을 읽어 매끄러운 타원 단면을 연결했다. 벼슬과 다리는 4뷰 마스크에 겹친 둥근 볼륨의 파라미터를 피팅했다. 부리는 TOP에서 너비를, LEFT에서 앞쪽 입틈 및 상·하부 높이 구간을 읽어 뒤쪽에서 합쳤다. 각각 등록된 연속 암시 함수에서 cubic Marching Cubes로 추출하고, Taubin 및 QEM을 적용했다. 벼슬 LEFT는 전체 캐릭터의 실제 측면 패널에 있는 두 깃털의 기울기로 다시 등록했다. 부리·벼슬·다리는 축별 다중 구간을 캡처한 Triple-Dexel 입력으로 재추출했다. 최종 크기·위치·피벗은 [layout.json](layout.json)에 있다. 부착면에 약간 겹치도록 배치하고 전체 실루엣에 맞춰 몸통·날개·다리의 크기와 중심을 소폭 보정했다.

## 측정

비교 대상은 이전의 [단일 64층 로프트](../section-study/chick-contour-loft-1600.glb)다. 같은 좌표계에서 GLB 삼각형을 네 방향으로 투영하고, 전체 병아리 아틀라스 마스크와의 IoU를 계산했다. 부착 위치 보정에도 이 아틀라스를 사용했으므로 수치는 입력 일치도를 나타낸다.

| 조건 | 정면 | 측면 | 후면 | TOP | 정면 아래 16% |
|---|---:|---:|---:|---:|---:|
| 단일 메시 | 95.21% | 95.30% | 95.20% | 97.22% | 74.81% |
| 분리 조립 | 97.12% | 97.39% | 97.17% | 96.10% | 89.60% |

정면 547행 중 벼슬 끝이 둘로 나뉘는 구간은 원래 7행, 단일 메시 0행, 조립 메시 6행이다.

Blender에 조립 GLB를 다시 열어 일곱 파츠의 양의 부피와 닫힌 토폴로지, 부착물과 몸통 사이의 실제 삼각형 교차를 검사했다. 양발의 최저점은 모두 z=0이다. 영상은 같은 포즈 96개를 24 fps로 표시한다. 조립과 단일 모델은 동일 배율이고 분해도만 여백을 넓혔다. 화면 좌우는 원래 정면 아틀라스 표기와 맞췄다.

## 재현

현재 폴더에서 실행한다. 등록된 이미지, 스택, 피팅 필드와 개별 메시가 포함되어 있어 조립만 재현할 때는 assemble.py부터 실행하면 된다.

```sh
../../../../../node_modules/.bin/tsx register.ts
python3 build.py
uv run --with numpy --with scipy --with pillow python fit_sections.py
uv run --with numpy --with scipy --with pillow python fit_lobes.py
uv run --with numpy --with scipy --with pillow python fit_beak.py
for part in body wing crest beak leg; do
  node ../../../../../apps/cli/bin/stack3.mjs pipeline run "$part/fitted.yaml"
done
for part in beak crest leg; do python3 textured/depth.py "$part"; done
blender -b --python-exit-code 1 -P assemble.py
blender -b --python-exit-code 1 -P review.py -- /tmp/chick-parts-review
uv run --with numpy --with pillow python measure.py /tmp/chick-parts-review
uv run --with pillow python present.py /tmp/chick-parts-review
```
