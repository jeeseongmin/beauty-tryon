import { Link } from "react-router-dom";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center bg-gradient-to-br from-pink-50 via-white to-purple-50">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
          Beauty Try-On
        </h1>
        <p className="text-lg text-gray-600 mb-12 max-w-md">
          구매 전에 미리 체험해보세요.
          <br />
          AI가 실시간으로 보여드립니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
          {/* Hair Color Card */}
          <Link to="/hair" className="group">
            <div className="relative overflow-hidden rounded-2xl bg-white shadow-lg border border-gray-100 p-8 transition-all group-hover:shadow-xl group-hover:-translate-y-1">
              <div className="text-5xl mb-4">💇‍♀️</div>
              <h2 className="text-xl font-bold mb-2">헤어 컬러 체험</h2>
              <p className="text-sm text-gray-500 mb-4">
                컬러 샴푸를 사용하면 어떤 색이 될까?
                <br />
                실시간 AR로 미리 확인해보세요.
              </p>
              <div className="flex gap-1.5 justify-center">
                {["#3b2314", "#8b6914", "#722f37", "#4a6b7a", "#c76b8a"].map(
                  (c) => (
                    <span
                      key={c}
                      className="w-6 h-6 rounded-full border border-gray-200"
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </div>
              <div className="mt-4 text-sm font-medium text-pink-500 group-hover:text-pink-600">
                체험하기 →
              </div>
            </div>
          </Link>

          {/* Nail Art Card */}
          <Link to="/nail" className="group">
            <div className="relative overflow-hidden rounded-2xl bg-white shadow-lg border border-gray-100 p-8 transition-all group-hover:shadow-xl group-hover:-translate-y-1">
              <div className="text-5xl mb-4">💅</div>
              <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
              <p className="text-sm text-gray-500 mb-4">
                네일 아트 필름이 내 손에 어울릴까?
                <br />
                카메라로 실시간 시뮬레이션!
              </p>
              <div className="flex gap-1.5 justify-center">
                {["#cc0000", "#e8b4b8", "#7b1fa2", "#1a237e", "#ffd700"].map(
                  (c) => (
                    <span
                      key={c}
                      className="w-6 h-6 rounded-full border border-gray-200"
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </div>
              <div className="mt-4 text-sm font-medium text-purple-500 group-hover:text-purple-600">
                체험하기 →
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-gray-400 border-t">
        © 2026 Beauty Try-On. Powered by AI.
      </footer>
    </main>
  );
}
