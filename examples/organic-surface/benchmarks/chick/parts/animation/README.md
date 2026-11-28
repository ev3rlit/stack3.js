# 병아리 첫 애니메이션

[Cycles 영상](chick-showcase.mp4) · [반복 미리보기](chick-showcase.gif) · [애니메이션 GLB](chick-showcase.glb) · [Blender 원본](chick-showcase.blend)

Chick_Showcase는 24 fps, 6.5초짜리 단일 클립이다. 기존 컬러 병아리의 1,760개 삼각형, 9개 메시와 5개 텍스처를 사용한다. 12본 리그에서 발과 발목의 가중치를 나눠 발바닥을 고정하면서 몸통을 숙일 수 있게 했다. 날개·벼슬·눈은 각 부착 지점을 기준으로 움직인다.

| 시간 | 동작 |
|---|---|
| 0.00–0.67초 | 호흡과 눈 깜빡임 |
| 0.67–2.33초 | 왼발, 오른발, 왼발로 세 걸음 전진 |
| 2.33–4.50초 | 바닥을 살피고 다른 속도로 두 번 쪼기 |
| 4.50–5.63초 | 몸을 낮춘 뒤 날개를 두 번 퍼덕이며 뒤로 홉 |
| 5.63–6.50초 | 착지하고 벼슬이 뒤따라 흔들린 뒤 대기로 복귀 |

홉의 수평 이동은 세 걸음 동안의 전진 거리를 되돌린다. Blender 재생 범위는 1–156프레임이다. GLB에는 6.5초 시점의 닫힘 키도 들어 있다. 영상은 첫 포즈의 중복 프레임을 제외한 156프레임으로 내보냈다.

[검증 결과](motion-checks.json)는 내보낸 GLB를 새 Blender 장면에서 다시 연 뒤 모든 샘플의 스키닝된 정점을 측정한 값이다. 첫·끝 정점 위치, 지지발 접지 중의 이동량, 부리 끝과 기준 바닥의 간격, 점프 시 발의 높이, 몸통과 각 파츠의 접촉을 검사한다. 수치는 높이 1인 원본 병아리를 기준으로 한다.

이 디렉터리에서 재현할 수 있다.

```sh
blender -b ../textured/chick-studio.blend --python-exit-code 1 -P build_motion.py
blender -b --python-exit-code 1 -P verify.py
blender -b chick-showcase.blend --python-exit-code 1 -P render.py -- /tmp/chick-showcase-frames
python3 encode.py /tmp/chick-showcase-frames
```
