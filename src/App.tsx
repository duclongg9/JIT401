import { useState, useEffect } from 'react';
import localforage from 'localforage';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { fsrs, createEmptyCard, Rating, generatorParameters, State } from 'ts-fsrs';
import type { Card } from 'ts-fsrs';
import { differenceInDays } from 'date-fns';
import { Bell, BellRing } from 'lucide-react';

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

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // App Data
  const [loading, setLoading] = useState(true);
  const [flashcards, setFlashcards] = useState<FlashcardData[]>([]);
  const [cardStates, setCardStates] = useState<Record<string, Card>>({});
  
  // Quiz State
  const [studyQueue, setStudyQueue] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentOptions, setCurrentOptions] = useState<{text: string, html: string, isCorrect: boolean}[]>([]);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [showFurigana, setShowFurigana] = useState(true);
  const [showVi, setShowVi] = useState(false);
  
  const [sessionScore, setSessionScore] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);

  // Time Logic
  const examDate1 = new Date('2026-04-03T00:00:00');
  const examDate2 = new Date('2026-04-09T00:00:00');
  const today = new Date();
  
  const daysLeft1 = Math.max(0, differenceInDays(examDate1, today));
  const daysLeft2 = Math.max(0, differenceInDays(examDate2, today));

  useEffect(() => {
    const initApp = async () => {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist().catch(() => {});
      }
      
      const notifPref = localStorage.getItem('jit401_reminder');
      if (notifPref === 'enabled') setReminderEnabled(true);

      let data: FlashcardData[] = [];
      try {
        const res = await fetch('/flashcards.json');
        data = await res.json();
        setFlashcards(data);
      } catch (e) {
        console.error("Failed to load data", e);
      }

      const dbCards = await localforage.getItem<Record<string, any>>('JIT401_CARDS');
      const loadedStates: Record<string, Card> = {};
      
      const now = new Date();
      let dueQueue: string[] = [];
      let newQueue: string[] = [];

      data.forEach(fc => {
        if (dbCards && dbCards[fc.id]) {
          const card = parseState(dbCards[fc.id]);
          loadedStates[fc.id] = card;
          if (card.state === State.New) {
            newQueue.push(fc.id);
          } else if (card.due <= now) {
            dueQueue.push(fc.id);
          }
        } else {
          loadedStates[fc.id] = createEmptyCard();
          newQueue.push(fc.id);
        }
      });

      // Limit new cards to 20
      const selectedNew = newQueue.slice(0, 20);
      const finalQueue = [...dueQueue, ...selectedNew];

      setCardStates(loadedStates);
      setStudyQueue(finalQueue);
      setLoading(false);
      
      // Update badge if supported (iOS 16.4+ standalone PWAs)
      if ('setAppBadge' in navigator) {
          try {
             if(finalQueue.length > 0) {
                 (navigator as any).setAppBadge(finalQueue.length);
             } else {
                 (navigator as any).clearAppBadge();
             }
          } catch(e){}
      }
    };

    initApp();
  }, []);

  const toggleReminder = async () => {
      if (!('Notification' in window)) {
          alert('Thiết bị của bạn không hỗ trợ Notifications gốc Web.');
          return;
      }
      if (Notification.permission === 'granted') {
          setReminderEnabled(true);
          localStorage.setItem('jit401_reminder', 'enabled');
          alert('Đã kích hoạt! Nếu bạn chưa học xong trong ngày, hệ thống sẽ đẩy thông báo hoặc hiển thị huy hiệu đỏ trên màn hình chính.');
      } else if (Notification.permission !== 'denied') {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
              setReminderEnabled(true);
              localStorage.setItem('jit401_reminder', 'enabled');
              alert('Cấp quyền thành công! Hãy chắc chắn bạn đã "Add to Home Screen" trên Safari để tính năng hoạt động ngầm (Push).');
          } else {
              alert('Bạn đã từ chối cấp quyền thông báo.');
          }
      } else {
          alert('Quyền thông báo đã bị chặn. Vui lòng mở Settings Safari để cấp lại quyền.');
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
    if (selectedOptionIndex !== null) return; 
    
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
      
      // Update badge if study completes
      if(currentIndex === studyQueue.length - 1 && 'clearAppBadge' in navigator) {
          try { (navigator as any).clearAppBadge() } catch(e){}
      }
    }
  };

  const handleNext = () => {
    if (currentIndex < studyQueue.length - 1) {
      setCurrentIndex(c => c + 1);
    } else {
      setSessionFinished(true);
    }
  };

  const totalCards = flashcards.length;
  const completedCards = flashcards.filter(f => cardStates[f.id] && cardStates[f.id].state !== State.New).length;
  const completionPercentage = totalCards > 0 ? Math.round((completedCards / totalCards) * 100) : 0;

  const chartData = {
    labels: ['Đã lưu vào kho', 'Chưa học'],
    datasets: [{
      data: [completionPercentage, 100 - completionPercentage],
      backgroundColor: ['#2D4A22', '#E5E7EB'],
      borderWidth: 0,
    }]
  };

  const handleReset = async () => {
    if (confirm("🚨 Bạn có chắc chắn muốn XÓA TOÀN BỘ lịch sử ôn tập FSRS? Thao tác này KHÔNG THỂ KHÔI PHỤC!")) {
        await localforage.removeItem('JIT401_CARDS');
        window.location.reload();
    }
  };

  if (loading) return <div className="min-h-[100dvh] flex items-center justify-center text-gray-500">Đang khởi tạo NLP...</div>;

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
        
        {/* ==================== DASHBOARD VIEW ==================== */}
        {activeTab === 'dashboard' && (
          <section>
              <div className="flex flex-col md:flex-row justify-between md:items-end mb-8">
                  <div>
                      <h1 className="text-3xl font-bold text-gray-900">Tiến độ Học thuật JIT401</h1>
                      <p className="mt-2 text-gray-600">Hệ thống Lặp lại Ngắt quãng (FSRS) - Cập nhật dữ liệu NLP</p>
                  </div>
                  <button 
                      onClick={toggleReminder}
                      className={`mt-4 md:mt-0 flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${reminderEnabled ? 'bg-green-100 text-[#2D4A22] border border-green-200' : 'bg-orange-50 text-[#C75B43] border border-orange-200 hover:bg-orange-100'}`}
                  >
                      {reminderEnabled ? <BellRing size={16}/> : <Bell size={16}/>}
                      <span>{reminderEnabled ? 'Nhắc nhở Đang bật' : 'Bật nhắc nhở Hàng ngày'}</span>
                  </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center text-center">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Đếm ngược Đợt 1</h3>
                      <div className="text-4xl font-bold text-gray-800 mb-1">{daysLeft1}</div>
                      <p className="text-xs text-gray-400">Ngày đến 03/04/2026</p>
                  </div>
                  
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center text-center">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Đếm ngược Đợt 2</h3>
                      <div className="text-4xl font-bold text-gray-500 mb-1">{daysLeft2}</div>
                      <p className="text-xs text-gray-400">Ngày cứu cánh 09/04/2026</p>
                  </div>

                  <div className="bg-orange-50 rounded-xl shadow-sm border border-[#C75B43] p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-orange-100 transition-colors" onClick={() => setActiveTab('study')}>
                      <h3 className="text-sm font-semibold text-[#C75B43] uppercase tracking-wider mb-2">Chờ Duyệt Hôm Nay</h3>
                      <div className="text-5xl font-bold text-[#C75B43] mb-1">{studyQueue.length}</div>
                      <p className="text-xs text-black/50">Vào Trạm Ôn Luyện ngay</p>
                  </div>

                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center w-full">Độ phủ Kiến thức</h3>
                      <div className="relative w-full h-[100px] flex justify-center mt-2">
                          <Doughnut data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
                          <div className="absolute inset-0 flex items-center justify-center flex-col">
                              <span className="text-xl font-bold text-[#2D4A22]">{completionPercentage}%</span>
                          </div>
                      </div>
                  </div>
              </div>

              <div className="flex justify-center mb-8">
                  <button onClick={handleReset} className="text-xs text-red-500 border border-red-200 bg-red-50 px-3 py-1.5 rounded hover:bg-red-100 transition-colors">
                      🔄 Reset toàn bộ tiến trình học (Học lại từ đầu)
                  </button>
              </div>
          </section>
        )}

        {/* ==================== STUDY VIEW ==================== */}
        {activeTab === 'study' && (
          <section>
            {studyQueue.length === 0 ? (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 text-center mt-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Tuyệt vời!</h2>
                <p className="text-gray-600 mb-6">Bạn đã không còn thẻ nào để ôn hôm nay. Hãy quay lại vào ngày mai để luyện tập trí nhớ dài hạn!</p>
              </div>
            ) : sessionFinished ? (
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 text-center mt-6 animate-fade-in">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Kết quả phiên luyện tập</h2>
                <div className="text-5xl font-bold text-[#C75B43] mb-4">{Math.round((sessionScore / studyQueue.length) * 100)}%</div>
                <p className="text-gray-600 mb-6">FSRS đã ghi lại tiến trình. Các câu sai sẽ sớm được lặp lại vào ngày mai.</p>
                <button onClick={() => window.location.reload()} className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2 px-6 rounded-lg">
                    Cập nhật Dữ liệu
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-6 flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Trạm Ôn Luyện</h1>
                        <p className="mt-1 text-gray-600 text-sm md:text-base">Mô-đun: {flashcards.find(f => f.id === studyQueue[currentIndex])?.category}</p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-500">Tiến độ:</span>
                        <span className="text-2xl font-bold text-[#C75B43] ml-2">{currentIndex + 1}/{studyQueue.length}</span>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-100 px-4 md:px-6 py-3 flex flex-wrap justify-between items-center gap-4">
                        <span className="text-sm font-semibold px-2 py-1 rounded bg-orange-100 text-orange-800 border border-orange-200">
                           Trạng thái: {cardStates[studyQueue[currentIndex]]?.state === State.New ? 'Thẻ Mới (New)' : 'Ôn Tập Lỗi Xa (Learning)'}
                        </span>
                        <div className="flex space-x-3 w-full md:w-auto justify-between md:justify-end">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" checked={showFurigana} onChange={e => setShowFurigana(e.target.checked)} className="rounded text-[#C75B43]" />
                                <span className="text-sm text-gray-700 font-medium">Furigana</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer ml-4">
                                <input type="checkbox" checked={showVi} onChange={e => setShowVi(e.target.checked)} className="rounded text-[#C75B43]" />
                                <span className="text-sm text-gray-700 font-medium">Bản dịch Tiếng Việt</span>
                            </label>
                        </div>
                    </div>

                    <div className="p-4 md:p-8 min-h-[300px] flex flex-col justify-between">
                        <div className="mb-8 text-center md:text-left">
                            <h2 className="text-xl md:text-3xl font-bold text-gray-800 jp-text leading-loose mb-4 break-words"
                                dangerouslySetInnerHTML={{ __html: flashcards.find(f => f.id === studyQueue[currentIndex])?.kanji_html || '' }}>
                            </h2>
                            {showVi && (
                              <p className="text-base md:text-lg text-blue-800 bg-blue-50 p-3 rounded-md border border-blue-100 inline-block font-medium animate-fade-in shadow-inner">
                                  {flashcards.find(f => f.id === studyQueue[currentIndex])?.vietnamese_translation}
                              </p>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mt-auto">
                            {currentOptions.map((opt, idx) => {
                              const isSelected = selectedOptionIndex === idx;
                              const showStatus = selectedOptionIndex !== null;
                              
                              let btnClass = "w-full text-left p-3 md:p-4 rounded-lg border-2 transition-all duration-200 group relative";
                              
                              if (!showStatus) {
                                btnClass += " border-gray-200 hover:border-[#C75B43] hover:bg-orange-50 cursor-pointer text-gray-800";
                              } else {
                                btnClass += " opacity-90 cursor-default";
                                if (opt.isCorrect) {
                                  btnClass += " border-[#2D4A22] bg-green-50 text-gray-900 shadow-md transform scale-[1.02]";
                                } else if (isSelected && !opt.isCorrect) {
                                  btnClass += " border-[#C75B43] bg-red-50 text-gray-900";
                                } else {
                                  btnClass += " border-gray-200 opacity-50 text-gray-600";
                                }
                              }

                              return (
                                <button key={idx} className={btnClass} onClick={() => handleSelectOption(idx)}>
                                  <div className="text-base md:text-lg font-bold mb-1 pointer-events-none jp-text leading-relaxed" dangerouslySetInnerHTML={{ __html: opt.html }}></div>
                                </button>
                              );
                            })}
                        </div>
                    </div>

                    <div className="bg-gray-50 border-t border-gray-100 px-6 py-4 flex flex-col md:flex-row justify-between items-center h-auto min-h-16 gap-4">
                        <div className="text-xs text-gray-400 italic">
                            {selectedOptionIndex !== null ? (currentOptions[selectedOptionIndex].isCorrect ? 'Tuyệt vời. FSRS ghi nhận Tốt (Good).' : 'Đã Lỗi. FSRS ghi nhận Quên (Again).') : ''}
                        </div>
                        {selectedOptionIndex !== null && (
                          <button onClick={handleNext} className="w-full md:w-auto bg-gray-800 hover:bg-gray-900 text-white font-medium py-3 md:py-2 px-6 rounded-lg transition-colors animate-fade-in shadow-md text-base">
                              {currentIndex < studyQueue.length - 1 ? 'Câu tiếp theo ➔' : 'Hoàn thành Phiên'}
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
