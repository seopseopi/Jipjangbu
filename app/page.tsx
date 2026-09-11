const navItems = [
  ["오늘", "today"],
  ["업무일지", "journal"],
  ["매물 관리", "listings"],
  ["고객 관리", "customers"],
  ["업무 달력", "calendar"],
] as const;

const todayItems = [
  { time: "09:30", type: "집방문예약", title: "아이파크 101동 1203호", meta: "전세 · 33평", tone: "blue" },
  { time: "11:00", type: "전화", title: "고객 상담", meta: "아파트 전세 문의", tone: "violet" },
  { time: "14:00", type: "매물등록", title: "힐스테이트 204동 802호", meta: "매매 · 신규", tone: "green" },
  { time: "16:30", type: "잔금예정", title: "우방 103동 501호", meta: "계약 일정", tone: "orange" },
];

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">업</span>
          <span><strong>업무비서</strong><small>부동산 업무관리</small></span>
        </div>
        <nav aria-label="주요 메뉴">
          {navItems.map(([label, key], index) => (
            <button className={`nav-item ${index === 0 ? "active" : ""}`} key={key} type="button">
              <span className={`nav-icon ${key}`} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" type="button"><span className="nav-icon settings" />설정</button>
          <div className="profile"><span>아</span><div><strong>아버지</strong><small>관리자</small></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">2026년 9월 11일 금요일</p><h1>오늘의 업무</h1></div>
          <button className="primary-button" type="button"><span>＋</span> 새 업무 등록</button>
        </header>

        <div className="metric-grid">
          <article className="metric-card featured"><p>오늘 업무</p><strong>7<small>건</small></strong><span>완료 3 · 예정 4</span></article>
          <article className="metric-card"><p>진행 중 매물</p><strong>106<small>건</small></strong><span className="positive">이번 주 5건 등록</span></article>
          <article className="metric-card"><p>전체 고객</p><strong>609<small>명</small></strong><span>최근 수정 50명</span></article>
          <article className="metric-card"><p>다가오는 일정</p><strong>2<small>건</small></strong><span className="attention">7일 안에 잔금 예정</span></article>
        </div>

        <div className="content-grid">
          <section className="panel schedule-panel">
            <div className="panel-head"><div><p className="eyebrow">TODAY</p><h2>오늘 일정</h2></div><button className="text-button" type="button">전체 보기</button></div>
            <div className="schedule-list">
              {todayItems.map((item) => (
                <article className="schedule-row" key={`${item.time}-${item.type}`}>
                  <time>{item.time}</time>
                  <span className={`status-dot ${item.tone}`} />
                  <div className="schedule-copy"><strong>{item.title}</strong><span>{item.meta}</span></div>
                  <span className={`tag ${item.tone}`}>{item.type}</span>
                  <button className="more" type="button" aria-label={`${item.title} 더 보기`}>•••</button>
                </article>
              ))}
            </div>
          </section>

          <aside className="panel quick-panel">
            <div className="panel-head"><div><p className="eyebrow">QUICK ENTRY</p><h2>빠른 업무 등록</h2></div></div>
            <label>고객 또는 연락처<input placeholder="이름이나 전화번호 검색" /></label>
            <div className="field-row"><label>업무구분<select defaultValue=""><option value="" disabled>선택</option><option>전화</option><option>매물등록</option><option>집방문예약</option></select></label><label>일자<input type="date" defaultValue="2026-09-11" /></label></div>
            <label>내용<textarea placeholder="업무 내용을 간단히 입력하세요" rows={3} /></label>
            <button className="quick-submit" type="button">업무 저장</button>
          </aside>
        </div>

        <section className="panel recent-panel">
          <div className="panel-head"><div><p className="eyebrow">RECENT</p><h2>최근 업무</h2></div><div className="search-stub">검색 <span>⌕</span></div></div>
          <div className="table-head"><span>일자</span><span>업무구분</span><span>고객</span><span>물건</span><span>내용</span></div>
          <div className="empty-preview">엑셀의 현재·과거 업무 기록을 한곳에서 빠르게 찾을 수 있도록 정리 중입니다.</div>
        </section>
      </section>
    </main>
  );
}
