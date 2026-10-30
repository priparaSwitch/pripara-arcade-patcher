# Third-party notices

이 문서는 포함된 제3자 구성요소의 출처와 라이선스를 안내합니다. **프로젝트 전체에 MIT 또는 다른 라이선스를 부여하는 문서가 아닙니다.** 프로젝트 자체의 전체 라이선스는 아직 지정되지 않았습니다.

## node-unrar-js / UnRAR WebAssembly

- 원 프로젝트: [YuJianrong/node-unrar.js](https://github.com/YuJianrong/node-unrar.js)
- 기존 벤더 기준 버전: **node-unrar-js 2.0.2**
- 포함 위치: [`web/engine/vendor/unrar/`](web/engine/vendor/unrar/)
- JavaScript wrapper: **MIT**, Copyright © 2017 Jianrong Yu — [LICENSE-MIT.txt](web/engine/vendor/unrar/LICENSE-MIT.txt)
- UnRAR decoder: Alexander Roshal의 **별도 UnRAR 라이선스** — [LICENSE-UnRAR.txt](web/engine/vendor/unrar/LICENSE-UnRAR.txt)

MIT wrapper 라이선스가 UnRAR decoder 전체나 이 프로젝트의 게임 패치에 확장된다고 해석하지 않습니다. 각 라이선스의 저작권·허가·면책 문구를 원문 그대로 보존하세요.

포함된 `unrar.wasm`과 `Extractor.js`, Emscripten wrapper `unrar.js`의 출처·기존 수정 내용은 [벤더 README](web/engine/vendor/unrar/README.txt)에 기록되어 있습니다. `unrar.js`에는 동적 함수 생성 부분을 동등한 closure로 바꾼 기존 수정이 있으며, `unrar.wasm`은 해당 고정 벤더 원본을 사용합니다. 이 저장소 준비 작업에서 새 decoder를 외부 서버로부터 받아 실행하도록 바꾸지 않았습니다.

`selected-core.js`는 기존 로컬 패처의 선택 파일 추출 어댑터에서 이어온 코드입니다. 필요한 압축 파일 하나의 제한된 범위를 decoder에 제공하며, 입력 RAR 안의 코드를 실행하지 않습니다. 이 선택 어댑터의 현재 I/O와 수정 범위는 [SELECTED_ADAPTER.txt](web/engine/vendor/unrar/SELECTED_ADAPTER.txt)를 함께 보존합니다. 벤더 README의 이전 일반 추출기 설명보다 이 선택 어댑터 설명이 현재 경로에 해당합니다.

## 배포 시 유지할 파일

다음 파일은 JS·WASM과 함께 `web/` 안에 유지합니다.

- `web/engine/vendor/unrar/LICENSE-MIT.txt`
- `web/engine/vendor/unrar/LICENSE-UnRAR.txt`
- `web/engine/vendor/unrar/README.txt`
- `web/engine/vendor/unrar/SELECTED_ADAPTER.txt`

프로그램은 저장소에 포함된 decoder·차분을 같은 사이트의 상대 경로로 읽습니다. CDN이나 별도 UnRAR 서버를 런타임 의존성으로 사용하지 않습니다.

## 포함하지 않는 자료

원본 게임 RAR·완성 게임 EXE·QRReader.dll·게임 자산 완성본과 가상카메라 설치 파일은 이 저장소의 제3자 재배포 구성에 포함하지 않습니다. 사용자가 로컬에서 선택한 원본에서 필요한 내용을 읽고 패치 결과를 만드는 방식입니다. 이 안내가 원본 게임 자료에 대한 별도 권리나 배포 허가를 부여하지는 않습니다.
