# 돼지 귀 접힘 벤치마크

[코와 몸통 수정 전후](surface-revision/comparison.jpg) · [1,600면 버전 비교](surface-revision/game-comparison.jpg) · [표면 재구성과 검증](surface-revision/README.md)

[원본 레퍼런스](reference.png) · [조립 기준 4뷰](whole/atlas.png) · [펼친 귀 입력](ear/atlas.png) · [파츠별 4뷰](part-atlases.jpg)

[스튜디오 렌더](folded.png) · [펼친 자세](open.png) · [접힘 영상](ear-fold.mp4) · [본과 변형 단계](ear-bones.jpg)

[편집용 Blender](piglet-ear-rig.blend) · [애니메이션 GLB](piglet-rig.glb) · [게임용 1,600면 GLB](piglet-game.glb) · [정적 접힘 GLB](piglet-folded.glb)

## 귀의 복원과 접힘

귀의 소스는 펴진 상태의 독립 4뷰다. 64층 스프라이트 스택에서 귀의 높이별 폭·두께·중심을 측정하고, 두께가 있는 닫힌 단면 링으로 귀 한 장을 재구성했다. 안쪽 오목함은 TOP의 굽은 발자국을 참고한 피팅값이다. 한 장의 레퍼런스에서 보이지 않는 귀 뒤쪽과 펼쳤을 때의 길이는 추정했다.

같은 중립 귀를 좌우로 반사해 붙이고 각 귀에 EarRoot, EarBend, EarArch, EarRoll, EarTip 다섯 본을 넣었다. 뿌리 본은 고정하고 나머지 네 본에 전방 굽힘을 분산했다. 접힘선을 귀 폭을 따라 비스듬히 잡아 앞과 바깥으로 처지게 했다. 마지막 본의 좌우 접힘 각을 3도 다르게 설정했다. 개별 본을 움직여 양쪽 접힘 강도를 따로 바꿀 수 있다.

Blender와 GLB 클립은 24fps로 1–13프레임을 접힌 자세, 37–49프레임을 펼친 자세, 73–85프레임을 다시 접힌 자세로 둔다. 영상은 펼친 구간부터 시작해 전체 주기를 보여준다. Rest Position에서는 양 귀가 펴진다. 접힌 상태만 필요한 뷰어용 정적 GLB도 제공한다.

## 나머지 파츠

머리는 정면·측면 실루엣에서 둥근 단면을 이어 만들었다. 몸통과 네 다리는 각 파츠의 단면으로 점유장을 만들고, 어깨와 허벅지에만 부드러운 합집합을 적용해 하나의 닫힌 Torso 메시로 추출한다. 발굽 색은 높이 좌표로 등록한 텍스처에 둔다. 코 FRONT의 두 어두운 영역에서 위치와 지름을 읽고, 입구에서 안쪽 벽과 바닥까지 깊이가 연속적으로 바뀌는 타원형 단면 링을 배치한다. 코 안쪽 깊이는 추정값이다. 게임용 모델은 입구 링을 더 적은 분할로 직접 생성한다. 꼬리는 LEFT의 말린 선을 따라 굵기가 변하는 튜브로 복원했다. 겹치는 구간의 앞뒤 거리는 추정값이다. 꼬리 뿌리는 몸통에, 코·귀·눈은 머리에 접한다. 피부·발굽·눈은 스튜디오 조명을 받는 재질로 표현했다.

## 검증

메시 8개의 렌더용 조립본은 8,638개 삼각형이고 게임용 조립본은 1,600개다. Blender에 두 애니메이션 GLB를 다시 열어 양 귀의 변형을 85개 프레임에서 조사했다. 인접하지 않은 귀 삼각형의 자기 교차, 귀 뿌리의 이탈, 귀 끝의 머리 관통은 발견되지 않았다. 시작과 끝의 변형된 정점 위치가 일치했다. [기본 모델 검사](shape-checks.json) · [게임용 검사](game-checks.json)

[단색·재질 형상 검사](surface-checks.json)에서 정적 모델은 game 프로필을 통과했다. [4뷰 윤곽 검사](silhouettes.json)는 같은 단위 높이로 맞춘 생성 아틀라스와의 2D 일치도를 기록한다. 독립 3D 원본과의 오차 측정에는 별도의 깊이 참조가 필요하다. 고립된 꼬리의 측면 투영에서는 고리 안 배경이 1,401픽셀 남았다.

## 재생성

내장 ImageGen에 사용한 [파츠별 프롬프트](atlas-prompts.json)와 소스 PNG를 보존했다. 현재 폴더에서 실행한다.

```sh
../../../../node_modules/.bin/tsx register.ts
python3 build_parts.py
uv run --with numpy --with scipy --with pillow --with scikit-image --with shapely==2.1.2 python profiles.py
blender -b --python-exit-code 1 -P pig.py
blender -b --python-exit-code 1 -P verify.py
blender -b piglet-ear-rig.blend --python-exit-code 1 -P lod.py
blender -b --python-exit-code 1 -P verify.py -- "$PWD/piglet-game.glb"
blender -b --python-exit-code 1 -P check_surfaces.py -- piglet-folded.glb surface-revision/studio.json new
blender -b --python-exit-code 1 -P check_surfaces.py -- piglet-game.glb surface-revision/game.json new
blender -b piglet-ear-rig.blend --python-exit-code 1 -P render_review.py -- /tmp/piglet-review
uv run --with pillow python present.py /tmp/piglet-review
```
