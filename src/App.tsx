import { useState, useEffect } from 'react';
import localforage from 'localforage';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { fsrs, createEmptyCard, Rating, generatorParameters, State } from 'ts-fsrs';
import type { Card } from 'ts-fsrs';
import { differenceInDays, format } from 'date-fns';
import { Bell, BellRing, Clock, RotateCcw, History, Trophy } from 'lucide-react';

ChartJS.register(ArcElement, Tooltip, Legend);
const f = fsrs(generatorParameters({ enable_fuzz: false }));

interface FlashcardData {
  id: string;
  type: 'MCQ' | 'TF';
  kanji_html: string;
  vietnamese_translation: string;
  correct_answer: string;
  correct_answer_html: string;
  category: string;
}

interface QuizHistory {
  date: string;
  score: number;
  total: number;
  duration: number; // seconds
}

interface QuizSession {
  queue: string[];
  index: number;
  score: number;
  remainingTime: number;
  lastUpdate: number;
}

const parseState = (data: any): Card => ({
  ...data,
  due: new Date(data.due),
  last_review: data.last_review ? new Date(data.last_review) : undefined
});

const generateWrongAnswers = (allFlashcards: FlashcardData[], currentCard: FlashcardData, count: number = 3) => {
  if (currentCard.type === 'TF') {
      return currentCard.correct_answer === 'Đúng' ? [{ text: 'Sai', html: 'Sai' }] : [{ text: 'Đúng', html: 'Đúng' }];
  }
  const others = allFlashcards.filter(f => f.correct_answer !== currentCard.correct_answer && f.type === 'MCQ' && f.correct_answer !== 'Đúng' && f.correct_answer !== 'Sai');
  const shuffled = [...others].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(f => ({ text: f.correct_answer, html: f.correct_answer_html }));
};

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // App Data
  const [loading, setLoading] = useState(true);
  const [flashcards, setFlashcards] = useState<FlashcardData[]>([]);
  const [cardStates, setCardStates] = useState<Record<string, Card>>({});
  const [examHistory, setExamHistory] = useState<QuizHistory[]>([]);
  
  // Quiz State
  const [studyQueue, setStudyQueue] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentOptions, setCurrentOptions] = useState<{text: string, html: string, isCorrect: boolean}[]>([]);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [showFurigana, setShowFurigana] = useState(true);
  const [showVi, setShowVi] = useState(false);
  
  const [sessionScore, setSessionScore] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [remainingTime, setRemainingTime] = useState(1800); // 30 minutes default
  const [reminderEnabled, setReminderEnabled] = useState(false);

  // Time Logic Targets
  const examDate1 = new Date('2026-04-03T00:00:00');
  const examDate2 = new Date('2026-04-09T00:00:00');
  const today = new Date();
  
  const daysLeft1 = Math.max(0, differenceInDays(examDate1, today));
  const daysLeft2 = Math.max(0, differenceInDays(examDate2, today));

  useEffect(() => {
    const initApp = async () => {
      // Load basics
      const notifPref = localStorage.getItem('jit401_reminder');
      if (notifPref === 'enabled') setReminderEnabled(true);

      let data: FlashcardData[] = [];
      try {
        const res = await fetch('/flashcards.json');
        data = await res.json();
        setFlashcards(data);
      } catch (e) { console.error(e); }

      const dbCards = await localforage.getItem<Record<string, any>>('JIT401_CARDS');
      const hist = await localforage.getItem<QuizHistory[]>('JIT401_HISTORY') || [];
      setExamHistory(hist);

      const loadedStates: Record<string, Card> = {};
      const now = new Date();
      let dueQueue: string[] = [];
      let newQueue: string[] = [];

      data.forEach(fc => {
        if (dbCards && dbCards[fc.id]) {
          const card = parseState(dbCards[fc.id]);
          loadedStates[fc.id] = card;
          if (card.state === State.New) newQueue.push(fc.id);
          else if (card.due <= now) dueQueue.push(fc.id);
        } else {
          loadedStates[fc.id] = createEmptyCard();
          newQueue.push(fc.id);
        }
      });

      // Session Resume Logic
      const savedSession = await localforage.getItem<QuizSession>('JIT401_SESSION');
      if (savedSession && savedSession.queue.length > 0) {
          // Check if session is from the same day to keep it relevant
          const isSameDay = new Date(savedSession.lastUpdate).toDateString() === new Date().toDateString();
          if (isSameDay) {
              setStudyQueue(savedSession.queue);
              setCurrentIndex(savedSession.index);
              setSessionScore(savedSession.score);
              setRemainingTime(savedSession.remainingTime);
          } else {
              setStudyQueue([...dueQueue, ...newQueue.slice(0, 20)]);
              await localforage.removeItem('JIT401_SESSION');
          }
      } else {
          setStudyQueue([...dueQueue, ...newQueue.slice(0, 20)]);
      }

      setCardStates(loadedStates);
      setLoading(false);
    };

    initApp();
  }, []);

  // Save Session on Every Progress
  useEffect(() => {
    if (!loading && studyQueue.length > 0 && !sessionFinished) {
        const session: QuizSession = {
            queue: studyQueue,
            index: currentIndex,
            score: sessionScore,
            remainingTime,
            lastUpdate: Date.now()
        };
        localforage.setItem('JIT401_SESSION', session);
    }
  }, [currentIndex, sessionScore, remainingTime, loading, sessionFinished, studyQueue]);

  // Timer Interval
  useEffect(() => {
    if (!loading && activeTab === 'study' && !sessionFinished && studyQueue.length > 0) {
        const timerId = setInterval(() => {
            setRemainingTime(prev => {
                if (prev <= 1) {
                    clearInterval(timerId);
                    setSessionFinished(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timerId);
    }
  }, [activeTab, sessionFinished, studyQueue.length, loading]);

  const toggleReminder = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
        setReminderEnabled(true);
        localStorage.setItem('jit401_reminder', 'enabled');
    }
  };

  useEffect(() => {
    if (studyQueue.length > 0 && currentIndex < studyQueue.length) {
      const cardId = studyQueue[currentIndex];
      const cardData = flashcards.find(f => f.id === cardId);
      if (cardData) {
        const wrongs = generateWrongAnswers(flashcards, cardData, 3);
        const options = [
          { text: cardData.correct_answer, html: cardData.correct_answer_html, isCorrect: true },
          ...wrongs.map(w => ({ text: w.text, html: w.html, isCorrect: false }))
        ];
        if (cardData.type === 'TF') {
             setCurrentOptions(options.sort((a,b) => a.text.localeCompare(b.text)));
        } else {
             setCurrentOptions(options.sort(() => 0.5 - Math.random()));
        }
        setSelectedOptionIndex(null); 
      }
    }
  }, [currentIndex, studyQueue, flashcards]);

  const handleSelectOption = async (idx: number) => {
    if (selectedOptionIndex !== null || sessionFinished) return; 
    
    setSelectedOptionIndex(idx);
    const isCorrect = currentOptions[idx].isCorrect;
    if (isCorrect) setSessionScore(s => s + 1);

    const cardId = studyQueue[currentIndex];
    const currentState = cardStates[cardId];
    const rating = isCorrect ? Rating.Good : Rating.Again;
    
    const schedulingOptions = f.repeat(currentState, new Date()) as any;
    const option = schedulingOptions[rating];
    
    if (option) {
      const newCardState = option.card;
      const newStates = { ...cardStates, [cardId]: newCardState };
      setCardStates(newStates);
      await localforage.setItem('JIT401_CARDS', newStates);
    }
  };

  const finalizeSession = async () => {
      setSessionFinished(true);
      const entry: QuizHistory = {
          date: format(new Date(), 'dd/MM HH:mm'),
          score: sessionScore,
          total: studyQueue.length,
          duration: 1800 - remainingTime
      };
      const newHistory = [entry, ...examHistory].slice(0, 10);
      setExamHistory(newHistory);
      await localforage.setItem('JIT401_HISTORY', newHistory);
      await localforage.removeItem('JIT401_SESSION');
  };

  const handleNext = () => {
    if (currentIndex < studyQueue.length - 1) {
      setCurrentIndex(c => c + 1);
    } else {
      finalizeSession();
    }
  };

  const handleReset = async () => {
    if (confirm("🚨 XÓA TOÀN BỘ lịch sử FSRS & Lịch sử thi? Thao tác này KHÔNG THỂ KHÔI PHỤC!")) {
        await localforage.clear();
        window.location.reload();
    }
  };

  const cancelSession = async () => {
      if (confirm("Dừng luyện tập và hủy tiến trình hiện tại?")) {
          await localforage.removeItem('JIT401_SESSION');
          window.location.reload();
      }
  };

  const totalCards = flashcards.length;
  const completedCards = flashcards.filter(f => cardStates[f.id] && cardStates[f.id].state !== State.New).length;
  const completionPercentage = totalCards > 0 ? Math.round((completedCards / totalCards) * 100) : 0;

  const chartData = {
    labels: ['Lưu kho', 'Chưa học'],
    datasets: [{
      data: [completionPercentage, 100 - completionPercentage],
      backgroundColor: ['#2D4A22', '#E5E7EB'],
      borderWidth: 0,
    }]
  };

  if (loading) return <div className="min-h-[100dvh] flex items-center justify-center text-gray-500">Đang khởi tạo Session...</div>;

  return (
    <div className={`flex flex-col min-h-screen ${showFurigana ? '' : 'hide-furigana'}`}>
      
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
                <div className="flex items-center">
                    <span className="text-2xl font-bold text-gray-800 tracking-tighter">JIT<span className="text-[#C75B43]">401</span> CRASH</span>
                </div>
                <nav className="hidden md:flex space-x-8">
                    <button onClick={() => setActiveTab('dashboard')} className={`${activeTab === 'dashboard' ? 'nav-active' : ''} text-gray-500 hover:text-gray-900 px-3 py-2 text-sm font-medium transition-colors`}>Tổng quan</button>
                    <button onClick={() => setActiveTab('study')} className={`${activeTab === 'study' ? 'nav-active' : ''} text-gray-500 hover:text-gray-900 px-3 py-2 text-sm font-medium transition-colors`}>Ôn luyện</button>
                </nav>
                <div className="md:hidden flex items-center">
                    <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-gray-500 hover:text-gray-900 focus:outline-none text-2xl">≡</button>
                </div>
            </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 pb-3 absolute w-full shadow-lg">
              <button onClick={() => {setActiveTab('dashboard'); setMobileMenuOpen(false);}} className="block w-full text-left px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50">Tổng quan</button>
              <button onClick={() => {setActiveTab('study'); setMobileMenuOpen(false);}} className="block w-full text-left px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50">Ôn luyện</button>
          </div>
        )}
      </header>

      <main className="flex-grow w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
        
        {activeTab === 'dashboard' && (
          <section>
              <div className="flex flex-col md:flex-row justify-between md:items-end mb-8">
                  <div>
                      <h1 className="text-3xl font-bold text-gray-900">Tiến độ Học thuật</h1>
                      <p className="mt-2 text-gray-600">FSRS Engine v5 - Hệ thống tự động phục hồi Session</p>
                  </div>
                  <button onClick={toggleReminder} className={`mt-4 md:mt-0 flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${reminderEnabled ? 'bg-green-100 text-[#2D4A22]' : 'bg-orange-50 text-[#C75B43] border border-orange-200'}`}>
                      {reminderEnabled ? <BellRing size={16}/> : <Bell size={16}/>}
                      <span>{reminderEnabled ? 'Nhắc nhở: Bật' : 'Bật nhắc học'}</span>
                  </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Đến 03/04</h3>
                      <div className="text-4xl font-bold text-gray-800">{daysLeft1}d</div>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Đến 09/04</h3>
                      <div className="text-4xl font-bold text-gray-500">{daysLeft2}d</div>
                  </div>
                  <div className="bg-orange-50 rounded-xl border border-[#C75B43] p-6 text-center cursor-pointer hover:bg-orange-100 transition-colors" onClick={() => setActiveTab('study')}>
                      <h3 className="text-sm font-semibold text-[#C75B43] uppercase tracking-wider mb-2">Cần xử lý</h3>
                      <div className="text-5xl font-bold text-[#C75B43]">{studyQueue.length - currentIndex}</div>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Độ phủ</h3>
                      <div className="relative w-full h-[80px] flex justify-center mt-1">
                          <Doughnut data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
                          <div className="absolute inset-0 flex items-center justify-center font-bold text-[#2D4A22]">{completionPercentage}%</div>
                      </div>
                  </div>
              </div>

              {/* Exam History Section */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center space-x-2">
                       <History size={18} className="text-[#C75B43]"/>
                       <h2 className="text-base font-bold text-gray-800">Lịch sử Luyện thi (Gần nhất)</h2>
                  </div>
                  <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 text-gray-500">
                              <tr>
                                  <th className="px-6 py-3 font-semibold">Thời điểm</th>
                                  <th className="px-6 py-3 font-semibold">Kết quả</th>
                                  <th className="px-6 py-3 font-semibold">Tỷ lệ</th>
                                  <th className="px-6 py-3 font-semibold">Thời gian làm</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {examHistory.length === 0 ? (
                                  <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-400 italic">Chưa có dữ liệu thi cử.</td></tr>
                              ) : examHistory.map((h, i) => (
                                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                                      <td className="px-6 py-4 whitespace-nowrap">{h.date}</td>
                                      <td className="px-6 py-4 font-bold text-gray-700">{h.score}/{h.total}</td>
                                      <td className="px-6 py-4">
                                          <span className={`px-2 py-1 rounded text-xs font-bold ${h.score/h.total >= 0.8 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                              {Math.round((h.score/h.total)*100)}%
                                          </span>
                                      </td>
                                      <td className="px-6 py-4 text-gray-500">{formatTime(h.duration)}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>

              <div className="flex justify-center">
                  <button onClick={handleReset} className="text-xs text-red-500 border border-red-200 bg-red-50 px-3 py-1.5 rounded hover:bg-red-100 transition-colors">
                      🔄 Khởi động lại Toàn bộ (Xóa History + FSRS)
                  </button>
              </div>
          </section>
        )}

        {/* ==================== STUDY VIEW ==================== */}
        {activeTab === 'study' && (
          <section>
            {studyQueue.length === 0 ? (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 text-center mt-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Xong hết rồi!</h2>
                <p className="text-gray-600 mb-6 font-jp">お疲れ様でした。</p>
              </div>
            ) : sessionFinished ? (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 text-center mt-6 animate-fade-in">
                <Trophy size={48} className="mx-auto text-orange-400 mb-4"/>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Kết thúc phiên {remainingTime === 0 ? '(Hết giờ)' : ''}</h2>
                <div className="text-5xl font-bold text-[#C75B43] mb-4">{Math.round((sessionScore / studyQueue.length) * 100)}%</div>
                <p className="text-gray-600 mb-6">Điểm số: <span className="font-bold">{sessionScore}</span> / {studyQueue.length}</p>
                <button onClick={() => setActiveTab('dashboard')} className="bg-[#C75B43] text-white font-medium py-3 px-8 rounded-lg shadow-md">
                    Về Dashboard xem Lịch sử
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                    <div className="flex-1 w-full">
                        <div className="flex items-center space-x-2 mb-1">
                            <h1 className="text-3xl font-bold text-gray-900">Trạm Ôn Luyện</h1>
                            {currentIndex > 0 && (
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded uppercase tracking-widest">ĐANG RESUME</span>
                            )}
                        </div>
                        <p className="text-gray-600 text-sm truncate">{flashcards.find(f => f.id === studyQueue[currentIndex])?.category}</p>
                    </div>
                    
                    <div className="flex items-center space-x-4 w-full md:w-auto justify-between bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100">
                        <div className="flex items-center space-x-2 text-[#C75B43]">
                            <Clock size={20} className={remainingTime < 300 ? 'animate-pulse text-red-600' : ''}/>
                            <span className={`text-xl font-mono font-bold ${remainingTime < 300 ? 'text-red-600' : ''}`}>
                                {formatTime(remainingTime)}
                            </span>
                        </div>
                        <div className="h-8 w-[1px] bg-gray-200 hidden md:block"></div>
                        <div className="text-right">
                            <span className="text-2xl font-black text-gray-800">{currentIndex + 1}</span>
                            <span className="text-gray-400 text-sm font-bold ml-1">/ {studyQueue.length}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-100 px-4 md:px-6 py-3 flex flex-wrap justify-between items-center gap-4">
                        <div className="flex space-x-3">
                            <button onClick={cancelSession} className="flex items-center space-x-1 text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">
                                <RotateCcw size={12}/> <span>Hủy phiên</span>
                            </button>
                        </div>
                        <div className="flex space-x-3">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" checked={showFurigana} onChange={e => setShowFurigana(e.target.checked)} className="rounded text-[#C75B43]" />
                                <span className="text-sm text-gray-700 font-medium">Furigana</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer ml-4">
                                <input type="checkbox" checked={showVi} onChange={e => setShowVi(e.target.checked)} className="rounded text-[#C75B43]" />
                                <span className="text-sm text-gray-700 font-medium">Bản dịch</span>
                            </label>
                        </div>
                    </div>

                    <div className="p-4 md:p-8 min-h-[300px] flex flex-col justify-between">
                        <div className="mb-8">
                            <h2 className="text-xl md:text-3xl font-bold text-gray-800 jp-text leading-loose mb-4 break-words"
                                dangerouslySetInnerHTML={{ __html: flashcards.find(f => f.id === studyQueue[currentIndex])?.kanji_html || '' }}>
                            </h2>
                            {showVi && (
                              <p className="text-base md:text-lg text-blue-800 bg-blue-50/50 p-4 rounded-xl border border-blue-100 italic animate-fade-in shadow-inner">
                                  "{flashcards.find(f => f.id === studyQueue[currentIndex])?.vietnamese_translation}"
                              </p>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mt-auto">
                            {currentOptions.map((opt, idx) => {
                              const isSelected = selectedOptionIndex === idx;
                              const showStatus = selectedOptionIndex !== null;
                              let btnClass = "w-full text-left p-3 md:p-5 rounded-xl border-2 transition-all duration-200";
                              
                              if (!showStatus) {
                                btnClass += " border-gray-100 hover:border-[#C75B43] hover:bg-orange-50 cursor-pointer shadow-sm";
                              } else {
                                if (opt.isCorrect) btnClass += " border-[#2D4A22] bg-green-50 shadow-md transform scale-[1.02] z-10";
                                else if (isSelected && !opt.isCorrect) btnClass += " border-red-300 bg-red-50";
                                else btnClass += " border-gray-100 opacity-40 grayscale-[0.5]";
                              }

                              return (
                                <button key={idx} className={btnClass} onClick={() => handleSelectOption(idx)}>
                                  <div className="text-base md:text-lg font-bold jp-text leading-relaxed" dangerouslySetInnerHTML={{ __html: opt.html }}></div>
                                </button>
                              );
                            })}
                        </div>
                    </div>

                    <div className="bg-gray-50 border-t border-gray-100 px-6 py-4 flex flex-col md:flex-row justify-between items-center h-auto min-h-16 gap-4">
                        <div className="text-xs text-gray-400 font-medium tracking-wide uppercase">
                            {selectedOptionIndex !== null ? (currentOptions[selectedOptionIndex].isCorrect ? '✅ FSRS: GOOD' : '❌ FSRS: AGAIN') : 'CHỌN MỘT ĐÁP ÁN ĐỂ TIẾP TỤC'}
                        </div>
                        {selectedOptionIndex !== null && (
                          <button onClick={handleNext} className="w-full md:w-auto bg-gray-900 hover:bg-black text-white font-bold py-3 md:py-2 px-8 rounded-xl transition-all animate-fade-in shadow-lg">
                              {currentIndex < studyQueue.length - 1 ? 'CÂU TIẾP THEO ➔' : 'CHỐT ĐIỂM & LƯU LỊCH SỬ'}
                          </button>
                        )}
                    </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
