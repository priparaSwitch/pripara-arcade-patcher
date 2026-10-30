# GitHub Pages 배포 안내

프로젝트 이름은 `pripara-arcade-patcher`입니다. 이 문서는 **2026-10-30의 로컬 배포 준비 상태**를 설명합니다. 실제 GitHub 저장소 생성, 원격 push, Pages 배포를 완료했다는 의미는 아닙니다.

웹 패처 **1.0.3 / 게임 패치 V17**을 그대로 배포합니다. 새 호스팅을 준비하는 작업이며 게임 패치나 QR 입력 규칙을 추가로 변경하지 않습니다.

## 1. 공개할 파일의 경계

| 위치 | 역할 | Pages 게시 |
| --- | --- | --- |
| `web/` | HTML·CSS·JS·WASM, 차분과 패치 기준표 | 이 폴더만 게시 |
| `.github/workflows/pages.yml` | 검사와 Pages 배포 작업 | 실행 설정이며 사이트 파일에 포함하지 않음 |
| `tests/` 및 개발 도구 | 로컬·CI 검사 | 게시하지 않음 |
| `docs/`, 루트 문서 | 저장소 사용·배포 설명 | Pages artifact에 포함하지 않음 |
| `dist/` | `npm run package`의 배포 준비 ZIP | 생성 결과이며 Pages 게시 원본이 아님 |

패치 차분은 `web/data/`에 저장합니다. 사용자의 브라우저는 그 Pages 사이트의 상대 경로에서 차분을 받으며, 다른 패치 서버·API·CDN으로 연결하지 않습니다. Git LFS나 별도 파일 호스팅에 차분을 두는 구조도 사용하지 않습니다.

**원본 RAR, 원본·완성 게임 EXE, QRReader.dll, 게임 자산 완성본, 세이브, 실제 티켓, 자격증명을 저장소나 Actions artifact에 넣지 마세요.** 필요한 원본은 사용자가 자신의 PC에서 선택합니다. 현재 일본어 안내 그림도 원본 RAR에서 읽어 브라우저 안에서 복사하며, 완성 그림을 이 저장소에서 배포하지 않습니다.

이 저장소에는 코디 리모컨을 포함하지 않습니다. 가상카메라 드라이버·카메라 프로그램·실행 헬퍼의 설치 파일도 현재 배포 구성에 포함하지 않습니다.

## 2. 로컬 검사와 미리보기

프로젝트 루트에서 **Node.js 22 이상**으로 실행합니다.

```sh
npm test
npm run check
npm run preview
```

미리보기는 고정 포트 **18092**와 프로젝트 경로 **`/pripara-arcade-patcher/`**를 사용합니다.

```text
http://127.0.0.1:18092/pripara-arcade-patcher/
```

`index.html`을 파일 탐색기에서 직접 여는 방식은 지원하지 않습니다. 프로젝트 경로 아래에서도 JS·Worker·WASM·차분을 상대 경로로 읽는지 확인하세요. 브라우저에서 사용할 때 별도 실행 환경 설치나 서버 측 패치 처리는 없습니다.

### 선택 사항: 실제 원본 RAR 검사

원본을 보유한 로컬 PC에서만 실행합니다. 경로는 자신의 원본 위치로 바꿉니다.

```sh
npm run test:archive -- "D:\local-only\港机+4gb.rar"
```

이 검사는 필요한 헤더와 대상 파일을 선택적으로 읽고 해당 파일의 SHA-256, CRC, 패치 결과를 검증합니다. 전체 RAR 해시나 선택하지 않은 파일까지 검증했다는 의미는 아닙니다. 원본 RAR를 저장소로 복사하거나 CI에 첨부할 필요가 없습니다.

### 배포 준비 ZIP

```sh
npm run package
```

결과 ZIP은 `dist/`에 생성합니다. 이 ZIP은 사이트·저장소 배포 준비용이며, 브라우저가 사용자 원본으로 만드는 **게임 적용 ZIP**과 다릅니다. Pages에는 ZIP 자체나 저장소 전체를 올리지 않고 `web/`만 게시합니다.

## 3. GitHub 저장소와 Pages 설정

다음은 이후 운영자가 수행할 절차입니다. 이 문서를 작성한 로컬 준비 작업에서는 실행하지 않았습니다.

1. GitHub에 이름이 **`pripara-arcade-patcher`**인 빈 저장소를 만듭니다. GitHub Free에서는 공개 저장소의 Pages를 사용할 수 있습니다. 다른 플랜의 공개·비공개 저장소 지원 범위는 [공식 Pages 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)를 확인하세요.
2. 커밋 대상을 검토하고 로컬 검사를 실행합니다. 원본·완성 EXE나 개인 파일이 포함되지 않았는지 확인합니다.
3. 로컬 저장소의 기본 브랜치를 `main`으로 사용하고 원격을 연결한 뒤 push합니다. 아래 `<OWNER>`는 본인 계정 또는 조직 이름입니다.

```sh
git init -b main
git add .
git commit -m "Prepare browser-local arcade patcher"
git remote add origin https://github.com/<OWNER>/pripara-arcade-patcher.git
git push -u origin main
```

이미 로컬 Git 저장소가 초기화되어 있다면 `git init`을 다시 실행할 필요가 없습니다. 원격 주소에 토큰이나 비밀번호를 넣지 마세요.

4. 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다. 설정 전 첫 workflow가 실패했다면 설정 후 Actions에서 다시 실행합니다. [공식 설정 절차](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
5. `.github/workflows/pages.yml`이 `main` push 또는 수동 실행으로 검사한 다음 `web/`만 Pages artifact로 올리고 배포하도록 사용합니다. 저장소 루트나 `dist/`를 artifact 경로로 바꾸지 않습니다.
6. Actions 실행 결과와 `github-pages` 배포 환경의 URL을 확인합니다. 완료 후 예상 주소 형태는 아래와 같습니다.

```text
https://<OWNER>.github.io/pripara-arcade-patcher/
```

Pages artifact 업로드 경로는 `web/`이며, 배포 job에는 `pages: write`, `id-token: write` 권한과 `github-pages` 환경을 사용합니다. 파일 조회에는 `contents: read`를 사용합니다. 상세 구조는 [GitHub의 custom workflow 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)를 참고하세요.

첫 공개 후에는 개발자 도구에서 JS·Worker·WASM·차분이 같은 Pages 사이트에서 로드되는지, 원본 미선택·취소·SHA 불일치 처리가 정상인지 확인합니다. 실제 게임 패치 시험과 웹 배포 검사는 별개입니다.

## 4. 원본 검증과 V17 기준

`web/data/patch-manifest.json`과 `web/release.js`를 버전 기준으로 사용합니다. 현재 기준은 다음과 같습니다.

| 항목 | 기준 |
| --- | --- |
| 웹 버전 | `1.0.3` |
| 게임 패치 | `V17` |
| 완성 EXE 크기 | `19,845,120`바이트 |
| 완성 EXE SHA-256 | `61351e371c3fa7e3f872ed36e4769def4a5c7528dd91b828d215f04696142fa2` |
| 차분 형식 | `PPDELTA1`, gzip 압축 |

기준표에는 원 RAR의 EXE와 기존 카메라 보정 EXE에 각각 대응하는 원본 SHA·차분 SHA가 들어 있습니다. 선택한 원본의 크기·SHA-256, RAR CRC, 차분과 완성 EXE의 SHA-256이 일치해야 패치를 진행합니다. 차분만 받아 원본 없이 완성 게임을 내려받는 기능은 없습니다.

기본 구성에서 확인하는 대상은 최대 6개입니다.

- `Prineo.exe`
- `QRReader.dll` — 호환성 검증용이며 결과 ZIP에 포함하지 않음
- `system_options.txt`
- `camera/QRReader.ini`
- `media/past/hud/menu/entrance/window/ENT_Window_First.bin`
- `media/past/hud/menu/entrance/window/ENT_Window_First_tex.bin`

V17은 V15 마이티켓 출력을 유지하고, 인쇄하는 친구·NPC의 원래 정보를 우정티켓 앱형 QR로 출력합니다. 시작 스캔과 원래 자기 티켓·중복·아이템·외형·라이브 제한을 유지하며 End의 앱용 결과 QR은 생략합니다. **V17 우정티켓의 실제 게임 내 인식은 아직 사용자 확인 전**입니다. 격리된 원코드 송수신·이미지 검증을 실게임 확인으로 표시하지 않습니다.

## 5. GitHub 용량 제한

공식 문서 확인일: **2026-10-30**. 아래 기준은 서로 다른 제한입니다.

| 구분 | 공식 기준 | 이 프로젝트에서의 의미 |
| --- | --- | --- |
| 일반 Git 파일 | 50 MiB 초과 경고, 100 MiB 초과 차단 | 50 MB 파일 자체는 Git으로 올릴 수 있지만, 큰 파일을 포함할 필요가 있는지 먼저 검토 |
| 브라우저의 저장소 파일 업로드 | 파일당 최대 25 MiB | 더 큰 허용 파일은 Git을 사용해야 함 |
| Pages 게시 사이트 | 최대 1 GB | `web/` 게시물 기준 |
| Pages 대역폭 | 월 100 GB soft limit | 무제한 전송 보장이 아님 |
| Git LFS | Pages 사이트에서 사용 불가 | 차분을 LFS pointer로 바꾸지 않음 |

파일 크기 기준은 [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), Pages 크기·전송량은 [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), LFS 제한은 [About Git Large File Storage](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)에 근거합니다. 이 문서의 MB와 공식 제한의 MiB를 같은 수치로 혼동하지 마세요.

## 6. 라이선스와 구성요소 보존

프로젝트 전체 라이선스는 사용자가 지정하지 않았으므로 임의의 MIT 라이선스를 선언하지 않습니다. JavaScript UnRAR wrapper의 MIT 라이선스와 UnRAR decoder의 별도 라이선스는 해당 구성요소에 적용됩니다. 배포할 때 `web/engine/vendor/unrar/`의 라이선스·출처 안내를 유지하세요. [제3자 구성요소 안내](../THIRD_PARTY_NOTICES.md)
