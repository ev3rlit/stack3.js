# 흰 닭 유기체 벤치마크

[원본 레퍼런스](reference.png) · [전체 4뷰](whole/atlas.png) · [독립 파츠 4뷰](part-atlases.jpg) · [Blender 렌더](hero.png) · [측면](left.png) · [몸통 방향 수정 전후](body-orientation.jpg) · [360도 영상](hen-turntable.mp4) · [육수 수정 전후](wattle/revision.jpg)

[게임용 GLB](hen-game.glb) · [렌더용 GLB](hen.glb) · [편집용 Blender 파일](hen-studio.blend)

제공된 동물 그림의 세 번째 캐릭터를 기준으로 했다. 정면과 측면에서 동시에 드러나지 않는 볏의 폭, 육수 뒷면, 날개깃의 두께와 발가락 사이의 깊이는 추정값이다. 내장 ImageGen이 전체 4뷰와 여섯 가지 파츠 아틀라스를 생성했다. 독립 깊이 소스는 사용하지 않았다. [생성 프롬프트](atlas-prompts.json)

## 복원

* 몸통은 단일 머리·몸통 볼륨이다. 정면과 측면의 높이별 중심·반지름을 64개 단면에서 읽고 연속 타원 단면을 연결했다.
* 볏은 앞쪽에서 뒤쪽으로 작아지는 세 덩이를 연결했다. TOP의 앞뒤 배열과 LEFT의 마디 중심을 제약으로 쓴다. 육수는 원본 부리 아래의 짧고 둥근 두 볼륨을 기준으로 LEFT를 교체했다. FRONT에서 두 갈래의 폭과 골을, LEFT에서 높이별 앞뒤 두께를 읽어 단면을 잇고 윗부분을 연결했다. 조립 시 육수를 한 덩어리로 옮겨 하단의 두께를 보존한다. [수정 아틀라스](wattle/atlas.png) · [측면 생성 지시](wattle/left-prompt.txt)
* 날개는 측면 실루엣 내부에서 Poisson 방정식을 풀어 안팎의 두께를 만들고, 측면 원화의 깃털 경계에서 얕은 홈을 추정했다. 부리는 좌측의 상·하부 구간과 TOP 너비로 두 턱을 구성했다. 발은 짧은 발목·발뒤꿈치·세 발가락을 네 방향 마스크에 맞췄다.
* 여섯 파츠에 대해 전역 `stack3 build`로 RGBA 스택을 저장하고 피팅된 영점과 정렬된 스택/필드를 `stack3 pipeline run`에서 큐빅 Marching Cubes, Taubin 2회, QEM 순으로 처리했다. 스튜디오용과 게임용은 같은 필드에서 분기한다. 각 파츠의 등록된 색을 투영해 GLB에 PNG 6장을 내장했다.
* [배치 좌표](layout.json)의 몸통 yaw 180°로 독립 몸통의 앞뒤를 전체 캐릭터에 맞춘다. 날개와 발을 좌우 반사하고, 부리 부착면과 육수의 위치를 몸통에 맞췄다. 부리 끝은 이전 방향 수정본보다 0.008 단위 안쪽에 놓였다. 눈은 원본 정면의 위치를 읽어 몸통 표면에 붙인 독립 렌즈 두 개다. 게임용 1,596개, 스튜디오용 6,012개 삼각형이며 둘 다 10개 메시다.

## 검사

[게임용 기하 검사](game-checks.json) · [스튜디오용 검사](geometry-checks.json) · [윤곽 측정](silhouettes.json) · [추가 표면 검사](surface-checks.json)

두 GLB 모두 Blender에 다시 열어 몸통과 모든 부착물의 실제 삼각형 접촉 및 양발 z=0을 확인했다. 열린 에지, 뒤집힌 인접 면, 퇴화면은 0개였다. 게임용 파일에서 전체 생성 아틀라스에 대한 네 방향 평균 실루엣 IoU는 91.0%다. 육수의 두 아래쪽 돌출부가 정면 마스크에서도 확인된다. 볏에는 세 개의 부피 마디가 있으며, 측면 외곽선에서 높이 0.8% 이상 도드라지는 국소 봉우리는 입력·게임 메시 모두 두 개다. 아틀라스와의 일치도는 독립적인 실제 3D 정확도와 구별한다. 부리의 투영 UV에는 약 7.5% 중첩 경고가 있다. 이 GLB의 색 텍스처 투영에는 사용 가능하며, 고유한 라이트맵을 구울 때는 UV를 별도로 펼쳐야 한다.

## 재생성

이번 작업에 사용한 전역 CLI는 현재 체크아웃에서 빌드한 `0.6.6-local.organic.1`이다. 이 폴더에서 아래 순서로 실행한다. 준비된 입력·가이드가 있으므로 한 파츠의 게임용 메시만 재생성하려면 `stack3 pipeline run comb/mesh.yaml`로 충분하다.

```sh
stack3 --version
uv run --with numpy --with scipy --with pillow python prepare.py
uv run --with numpy --with scipy --with pillow python surfaces.py
blender -b --python-exit-code 1 -P hen.py -- game
blender -b --python-exit-code 1 -P hen.py
uv run --with numpy --with scipy --with pillow python measure.py
blender -b hen-studio.blend --python-exit-code 1 -P render.py -- /tmp/hen-turn-frames
uv run --with pillow python present.py /tmp/hen-turn-frames
```
