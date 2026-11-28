# Triple-Dexel 깊이 입력과 병아리 검증

[같은 카메라의 단색 비교](depth-comparison.jpg) · [합성 깊이 결합 GLB](chick-synthetic-depth-1600.glb) · [입력 가이드](fused.json) · [실행 레시피](fused.yaml) · [영역별 깊이 오차](depth-errors.json)

## 입력

색상 아틀라스와 윤곽 로프트에서 만든 기준 거리장에, 모델 좌표가 맞는 다른 소스의 XYZ 깊이·법선 구간을 추가한다. 단위 높이, 피벗, 축, 격자와 샘플 위치가 같아야 한다. 실제 제작에서는 아티스트가 디자인한 정렬된 닫힌 고해상도 메시나, 같은 형식으로 등록된 다중 깊이·법선 데이터가 필요하다. 단일 컬러 이미지나 방향당 첫 번째 표면만 있는 깊이맵에는 가려진 면의 진입·이탈 쌍이 모두 들어있지 않다.

`capture-dexel`은 닫힌 GLB 솔리드와 스택 격자를 입력받아 축별 광선 오프셋, 모든 해상 가능한 교차 깊이와 바깥쪽 법선, 원본 파일 SHA-256을 NPZ에 기록한다. 여러 솔리드가 겹치면 광선상에서 구간 합집합을 구한다. 점유 재구성은 세 축의 셀 중심 판정이 일치하는지 확인한다. 법선은 근접 거리의 접평면 추정에 쓰이며, Dual Contouring에서는 정점 배치에도 쓰인다. `sigma: 0`은 깊이 측정 영역 안에서 신호가 바뀌는 모서리의 측정 교점 위치를 유지한다. 이 예에서는 혼합된 영점의 Marching Cubes 연결을 사용했다.

`dexelOccupancy: measured`는 전체 측정으로 형상을 만들 수 있다. `depthRegions`를 쓰면 등록된 타원체 안쪽에서 측정값을 쓰고 경계에서 기존 윤곽 로프트로 이어진다. 예제에서는 좌우 날개와 앞쪽 머리에 영역 세 개를 지정했다. 자동으로 파츠를 찾거나 분리하지 않는다. 좌표가 다른 자산에는 영역을 다시 지정해야 한다. 입력 컬러는 기존 등록 스택에서 투영한다.

## 실험

원본 4뷰의 독립적인 실측 깊이는 없다. fixture.py가 이전 로프트 메시의 옆구리에 두 날개 테두리와 돌출부, 머리 앞쪽에 얕은 굴곡을 더한 합성 기준물을 만들었다. baseline은 컬러 아틀라스에서 복원한 이전 L-lod이고, roundtrip은 굴곡을 추가하지 않은 기존 L의 깊이를 같은 국소 결합 경로에 넣은 대조군이다. fused는 synthetic-reference.glb에서 캡처한 새로운 깊이를 넣은 조건이다. 모든 비교 모델의 최종 예산은 1,600면이다. 이 결과는 파츠의 원래 숨은 형태를 증명하지 않는다.

합성 기준물의 64³ 캡처에서 X/Y/Z 방향에 각각 39/5/74개의 다중 구간 광선이 있었다. 총 8,240개 교점 중 8,218개가 부호 변화 모서리에 있었다. 나머지 22개는 해당 격자에서 별도 표면으로 해상되지 않았다. 측정으로 바뀐 셀 중심은 592개였고, 결합 영역 중심부에서 유지된 측정 모서리는 1,154개였다. 전체 깊이에 정규화 DC를 적용한 탐색 실행은 한 셀의 복수 시트를 감지해 중단했다. full.yaml과 fused.yaml은 이 사례에 맞게 MC를 명시한다.

| 평균 절대 깊이 오차 · 모델 높이 1 | 로프트만 | 기존 로프트 재캡처 | 새 깊이 결합 |
|---|---:|---:|---:|
| 양 날개 · X 광선 | 0.01766 | 0.01770 | 0.00179 |
| 앞쪽 머리 · Y 광선 | 0.01424 | 0.01410 | 0.00072 |

비교 모델도 최종 GLB에서 광선을 새로 쏴서 측정했다. 기준물에서 지정 타원체 반경의 70% 안에 있는 깊이 교점만 평가하고, 같은 광선에서 모든 비교 모델의 구간 수가 일치할 때 순서대로 매칭했다. 날개 473/473개, 머리 96/96개가 포함됐다. 면 수 제한을 적용한 뒤에도 날개 림의 작은 각짐이 보인다. 기준물과의 깊이 오차 및 Blender 재임포트 형상 검사는 별도 JSON에 있다.

## 실행

준비된 데이터로 이 폴더에서 실행할 수 있다.

```sh
node ../../../../../../apps/cli/bin/stack3.mjs pipeline run fused.yaml
```

원본 데이터부터 다시 검증하려면 Blender로 fixture.py를 실행하고, 다음 명령을 사용한다. 실제 소스 사용 시 synthetic-reference.glb를 등록한 고해상도 메시로 바꾼다.

```sh
stack3 capture-dexel ../contour --source synthetic-reference.glb --output synthetic.npz
stack3 capture-dexel ../contour --source ../L.glb --output prior.npz
stack3 pipeline run roundtrip.yaml
stack3 pipeline run fused.yaml
stack3 pipeline run full.yaml
stack3 capture-dexel ../contour --source ../L-lod.glb --output checks/check-baseline.npz
stack3 capture-dexel ../contour --source roundtrip.glb --output checks/check-roundtrip.npz
stack3 capture-dexel ../contour --source fused.glb --output checks/check-fused.npz
uv run --with numpy python validate_depth.py checks
```
