# 병아리 컬러 렌더와 파츠별 깊이

[사선](hero.png) · [정면](front.png) · [측면](side.png) · [모델](chick-textured.glb) · [Blender 스튜디오](chick-studio.blend)

전체 병아리 LEFT에 보이는 두 깃털을 잘라 편집 참조로 사용했다. ImageGen으로 머리 돔을 제거하고 숨은 부착면을 추정한 뒤 원래 파츠 아틀라스의 두 번째 패널만 교체했다. TOP·FRONT·REAR의 등록 PNG 바이트는 동일하다. [수정 아틀라스](../crest/source.png) · [수정 전후](../crest/left-comparison.jpg) · [편집 프롬프트](../crest/left-prompt.txt)

종전 측면은 한 개의 실루엣 봉우리만 나타냈다. 수정 LEFT와 최종 메시의 수평 측면 투영은 모두 두 개를 나타낸다. 양쪽을 같은 크기로 맞춘 측면 실루엣 IoU는 95.12%다. 이는 수정 입력에 대한 적합도이며 독립적인 3D 정답에 대한 오차가 아니다.

## Triple-Dexel

세 파츠 각각의 등록된 로컬 스택 격자에서 XYZ 방향의 모든 해상 가능한 진입·이탈 깊이와 법선을 캡처했다. 이번 NPZ 소스는 각 아틀라스에 피팅한 QEM 이전 고밀도 메시다. 실제로 가려진 표면을 측정한 데이터는 없다. 입력으로부터 추정한 형상을 다시 캡처한 결과이며, 소스 GLB의 SHA-256이 NPZ에 포함되어 있다. 동일 좌표계의 독립 GLB가 있으면 같은 경로의 소스만 교체할 수 있다.

| 파츠 | 복수 구간 광선 | 부호 변화 모서리의 측정 교점 | 격자가 구별하지 못한 추가 교점 |
|---|---:|---:|---:|
| 벼슬 | 107 | 10,794 | 6 |
| 부리 | 440 | 19,052 | 4 |
| 다리·발 | 89 | 9,578 | 0 |

부리·벼슬·다리 폴더에 캡처된 NPZ, 고해상도 참조 메시, 실행 YAML과 가이드가 있다. `dexelOccupancy: measured`, `sigma: 0`, cubic Marching Cubes 및 파츠별 QEM 예산을 사용한다. 다리 하나의 형상을 반사해 양쪽에 쓴다.

## 렌더

각 파츠의 4뷰 RGB에서 기하학적 그림자를 약화하고, 표면 법선에 따라 뷰를 혼합하여 실제 UV 베이스컬러 PNG 5장을 베이크했다. GLB와 Blender 파일 안에 이미지를 패킹했다. 몸통 텍스처에는 눈이 포함되지 않는다. 원본 정면에서 눈 중심과 크기를 읽고 몸통 표면과의 교점을 구해 짙은 갈색의 독립 눈 메시 두 개를 고정했다. 광택과 반사광은 스튜디오 조명에서 생성된다.

형상 비교용 메시 1,600면에 눈을 각각 80면씩 더해 총 1,760면이다. GLB를 다시 열어 9개 메시, 5개 내장 이미지, 모든 부착물과 몸통의 접촉을 검사했다. 이 GLB에서 그대로 Cycles 48샘플, 1,000×1,000 PNG 세 장을 렌더했다. Blender 파일은 사선 사진의 조명과 카메라 설정으로 저장했다.

## 재생성

parts 폴더에서 실행한다. 이미 수정·등록된 왼쪽 패널과 피팅 필드가 들어 있다.

```sh
for part in beak crest leg; do python3 textured/depth.py "$part"; done
blender -b --python-exit-code 1 -P assemble.py
uv run --with numpy --with scipy --with pillow python textured/maps.py
blender -b --python-exit-code 1 -P textured/finish.py
```

독립 깊이 소스를 사용하려면 예를 들어 `python3 textured/depth.py crest --reference /absolute/path/aligned-crest.glb`로 교체한 뒤 조립과 렌더를 반복한다.
