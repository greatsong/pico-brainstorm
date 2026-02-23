import { useState, useRef, useEffect } from 'react';
import { sensorData as initialSensorData } from './data/sensors';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';

// Expert Personas for Multi-Expert Discussion Mode
const EXPERTS = [
  {
    id: 'hardware',
    name: '🔧 하드웨어 전문가',
    color: '#f97316',
    bgClass: 'bg-orange-50 border-orange-200',
    systemPrompt: `너는 전자공학/하드웨어 전문가야. 회로 설계, 전압 레벨, 인터페이스(I2C, SPI, UART), 배선, 전력 소모 등에 대해 전문적으로 조언해.
다른 전문가의 의견을 참고하여 하드웨어 관점에서 보완하거나 동의/반박해.
응답은 2-3문장으로 간결하게. 다른 전문가를 @멘션할 수 있어.`
  },
  {
    id: 'software',
    name: '💻 소프트웨어 전문가',
    color: '#3b82f6',
    bgClass: 'bg-blue-50 border-blue-200',
    systemPrompt: `너는 임베디드 소프트웨어 개발자야. MicroPython, 라이브러리 호환성, 코드 구조, 알고리즘 등에 대해 전문적으로 조언해.
다른 전문가의 의견을 참고하여 소프트웨어 관점에서 보완하거나 동의/반박해.
응답은 2-3문장으로 간결하게. 다른 전문가를 @멘션할 수 있어.`
  },
  {
    id: 'cost',
    name: '💰 비용분석가',
    color: '#22c55e',
    bgClass: 'bg-green-50 border-green-200',
    systemPrompt: `너는 구매/조달 전문가야. 가성비, 대안 부품, 비용 절감 방안, 구매처 등에 대해 전문적으로 조언해.
다른 전문가의 의견을 참고하여 비용 관점에서 보완하거나 동의/반박해.
응답은 2-3문장으로 간결하게. 다른 전문가를 @멘션할 수 있어.`
  }
];

function App() {
  const [selectedSensors, setSelectedSensors] = useState([]); // Array of selected sensors
  const [apiKey, setApiKey] = useState(() => {
    const envKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (envKey) return envKey;
    return localStorage.getItem('gemini_api_key') || '';
  });
  const [showSettings, setShowSettings] = useState(!apiKey);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState(() => {
    const saved = localStorage.getItem('pico_chat_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedModel, setSelectedModel] = useState(localStorage.getItem('pico_selected_model') || 'gemini-3-pro-preview');
  const [isGenerating, setIsGenerating] = useState(false);

  // Multi-Expert Discussion Mode
  const [discussionMode, setDiscussionMode] = useState(false);
  const [selectedExperts, setSelectedExperts] = useState(['hardware', 'software', 'cost']);
  const [discussionRounds, setDiscussionRounds] = useState(2);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [showExpertEditor, setShowExpertEditor] = useState(false);
  const [customExperts, setCustomExperts] = useState(() => {
    const saved = localStorage.getItem('pico_custom_experts');
    return saved ? JSON.parse(saved) : EXPERTS;
  });

  // Save custom experts to localStorage
  useEffect(() => {
    localStorage.setItem('pico_custom_experts', JSON.stringify(customExperts));
  }, [customExperts]);

  const handleSaveModel = (model) => {
    setSelectedModel(model);
    localStorage.setItem('pico_selected_model', model);
  };
  const [sortOption, setSortOption] = useState('popularity'); // popularity, price_asc, price_desc
  const [selectedCategory, setSelectedCategory] = useState('전체'); // 전체, Grove, 센서, 액추에이터...
  const chatEndRef = useRef(null);

  // Save chat history
  useEffect(() => {
    localStorage.setItem('pico_chat_history', JSON.stringify(chatHistory));
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);
  // Load and sort sensors
  const getFilteredSensors = () => {
    let filtered = [...initialSensorData];

    // 1. Filter by Category
    if (selectedCategory !== '전체') {
      if (selectedCategory === 'Grove 모듈') {
        filtered = filtered.filter(s => s.model.toLowerCase().includes('grove'));
      } else {
        filtered = filtered.filter(s => s.type === selectedCategory);
      }
    }

    // 2. Sort
    if (sortOption === 'popularity') {
      filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } else if (sortOption === 'price_asc') {
      filtered.sort((a, b) => parseInt(a.price.replace(/,/g, '')) - parseInt(b.price.replace(/,/g, '')));
    } else if (sortOption === 'price_desc') {
      filtered.sort((a, b) => parseInt(b.price.replace(/,/g, '')) - parseInt(a.price.replace(/,/g, '')));
    }
    return filtered;
  };

  const sensors = getFilteredSensors();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const handleSaveKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    setShowSettings(false);
  };

  // Multi-Selection Logic
  const toggleSensor = (sensor) => {
    setSelectedSensors(prev => {
      if (prev.find(s => s.model === sensor.model)) {
        return prev.filter(s => s.model !== sensor.model);
      } else {
        return [...prev, sensor];
      }
    });
  };

  const handleSelectAll = () => {
    // Select all visible sensors
    const newSelection = [...selectedSensors];
    sensors.forEach(sensor => {
      if (!newSelection.find(s => s.model === sensor.model)) {
        newSelection.push(sensor);
      }
    });
    setSelectedSensors(newSelection);
  };

  const handleDeselectAll = () => {
    setSelectedSensors([]);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !apiKey) return;
    if (isGenerating) return;

    const userMsg = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsGenerating(true);

    try {
      const ai = new GoogleGenAI({ apiKey });

      const componentListStr = initialSensorData.map(s => `- ${s.model} (${s.type})`).join('\n');

      const systemInstruction = `
너는 'Pico Brainstorm'이라는 이름의 메이커 보조 AI야.
반드시 아래 제공된 **[보유 부품 목록]**에 있는 부품들만 추천에 활용해야 해.
만약 사용자가 목록에 없는 부품을 물어보거나 찾으면, "죄송하지만 해당 부품은 현재 보유 목록에 없습니다."라고 정중히 답하고, 대신 목록에 있는 것 중에서 비슷한 역할을 하는 부품을 추천해줘.
사용자 질문에 대해 한국어로 친절하고 구체적으로 답변해줘.
응답은 Markdown 형식을 사용하여 가독성 있게 작성해줘 (리스트, 볼드체 등 활용).

[보유 부품 목록]
${componentListStr}
`;

      let context = "";
      if (selectedSensors.length === 1) {
        const s = selectedSensors[0];
        context = `현재 선택된 센서: ${s.model} (${s.description}). 이 센서를 활용한 창의적인 피코 2 W 프로젝트 아이디어를 논의하고 싶어.`;
      } else if (selectedSensors.length > 1) {
        const names = selectedSensors.map(s => s.model).join(', ');
        context = `현재 선택된 센서 목록(${selectedSensors.length}개): ${names}. 이 부품들을 조합하거나 활용하여 피코 2 W 프로젝트 아이디어를 논의하고 싶어.`;
      } else {
        context = `라즈베리파이 피코 2 W를 활용한 메이커 프로젝트 아이디어를 논의하고 싶어.`;
      }

      const fullPrompt = `${systemInstruction}\n\n${context}\n\n사용자 질문: ${userMsg.text}`;

      console.log(`Requesting ${selectedModel} with prompt length:`, fullPrompt.length);
      const result = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      });

      console.log("Stream result:", result);

      if (!result) {
        throw new Error("AI 모델로부터 응답이 없습니다 (Received undefined result).");
      }

      let fullText = "";
      setChatHistory(prev => [...prev, { role: 'model', text: "" }]);

      for await (const chunk of result) {
        let chunkText = "";
        try {
          if (typeof chunk.text === 'function') {
            chunkText = chunk.text();
          } else if (chunk.text) {
            chunkText = chunk.text;
          }
        } catch (e) {
          console.error("Error extracting text:", e);
        }

        fullText += chunkText;
        setChatHistory(prev => {
          const newHistory = [...prev];
          const lastMsg = newHistory[newHistory.length - 1];
          if (lastMsg.role === 'model') {
            lastMsg.text = fullText;
          }
          return newHistory;
        });
      }
    } catch (error) {
      console.error(error);
      let errorMsg = `오류 발생: ${error.message}`;
      if (error.message.includes('404') || error.message.includes('not found')) {
        errorMsg = `모델을 찾을 수 없습니다 (${selectedModel}). 다른 모델을 선택해주세요.`;
      } else if (error.message.includes('API key') || error.message.includes('403')) {
        errorMsg += ". API 키를 확인해주세요.";
      }
      setChatHistory(prev => [...prev, { role: 'error', text: errorMsg }]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Multi-Expert Discussion Handler
  const handleStartDiscussion = async () => {
    if (!chatInput.trim() || !apiKey) return;
    if (isDiscussing) return;

    const userQuestion = chatInput;
    const userMsg = { role: 'user', text: userQuestion };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsDiscussing(true);

    try {
      const ai = new GoogleGenAI({ apiKey });

      // Build context from selected sensors
      let sensorContext = "";
      if (selectedSensors.length > 0) {
        const names = selectedSensors.map(s => `${s.model} (₩${s.price})`).join(', ');
        sensorContext = `\n\n[선택된 부품 목록]: ${names}`;
      }

      const activeExperts = customExperts.filter(e => selectedExperts.includes(e.id));
      let conversationHistory = [];

      // Run discussion rounds
      for (let round = 0; round < discussionRounds; round++) {
        for (const expert of activeExperts) {
          // Build prompt with previous responses
          const prevResponses = conversationHistory.map(c =>
            `[${c.expertName}]: ${c.text}`
          ).join('\n\n');

          const fullPrompt = `${expert.systemPrompt}
${sensorContext}

[사용자 질문]: ${userQuestion}

${prevResponses ? `[이전 토론 내용]:\n${prevResponses}\n\n` : ''}
위 내용을 바탕으로 ${expert.name} 관점에서 의견을 제시해줘. 이전 전문가 의견이 있다면 참고하여 동의하거나 보완해줘.`;

          // Add placeholder message for this expert
          const expertMsg = {
            role: 'expert',
            expertId: expert.id,
            expertName: expert.name,
            expertColor: expert.color,
            expertBgClass: expert.bgClass,
            text: ""
          };
          setChatHistory(prev => [...prev, expertMsg]);

          const result = await ai.models.generateContentStream({
            model: selectedModel,
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          });

          let fullText = "";
          for await (const chunk of result) {
            let chunkText = "";
            try {
              if (typeof chunk.text === 'function') {
                chunkText = chunk.text();
              } else if (chunk.text) {
                chunkText = chunk.text;
              }
            } catch (e) {
              console.error("Error extracting text:", e);
            }

            fullText += chunkText;
            setChatHistory(prev => {
              const newHistory = [...prev];
              const lastMsg = newHistory[newHistory.length - 1];
              if (lastMsg.role === 'expert' && lastMsg.expertId === expert.id) {
                lastMsg.text = fullText;
              }
              return newHistory;
            });
          }

          conversationHistory.push({
            expertId: expert.id,
            expertName: expert.name,
            text: fullText
          });
        }
      }
    } catch (error) {
      console.error(error);
      setChatHistory(prev => [...prev, { role: 'error', text: `토론 중 오류 발생: ${error.message}` }]);
    } finally {
      setIsDiscussing(false);
    }
  };


  return (
    <div className="min-h-screen text-slate-800 font-sans selection:bg-indigo-200 selection:text-indigo-900">
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>

      <div className="max-w-[1600px] mx-auto h-screen p-4 md:p-6 lg:p-8 flex flex-col gap-6">

        <header className="flex justify-between items-center glass-panel rounded-2xl px-8 py-5">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-indigo-600 to-purple-600 text-white p-3 rounded-xl shadow-lg shadow-indigo-200">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 tracking-tight">
                Pico Brainstorm
              </h1>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Intelligent Maker Assistant</p>
            </div>
          </div>
          <button onClick={() => setShowSettings(true)} className={`group flex items-center gap-2 px-4 py-2 rounded-full transition-all border ${apiKey ? 'bg-white/50 border-white/50 hover:bg-white hover:shadow-md text-slate-600' : 'bg-red-50 border-red-200 text-red-600 animate-pulse'}`}>
            <span className="text-lg">{apiKey ? '🔑' : '⚠️'}</span>
            <span className="font-medium text-sm">{apiKey ? 'API Connected' : 'Connect API'}</span>
          </button>
        </header>

        <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">

          <aside className="col-span-12 md:col-span-4 lg:col-span-3 glass-panel rounded-3xl flex flex-col overflow-hidden h-full border border-white/60">
            <div className="p-6 pb-2">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Category</h2>
              <div className="flex gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
                {['전체', 'Grove 모듈', '센서', '액추에이터', '디스플레이', '입력장치', 'LED/조명', 'MCU/보드', '케이블/배선'].map(cat => (
                  <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors border ${selectedCategory === cat ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex justify-between items-center mb-2 px-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="selectAll"
                    className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition cursor-pointer"
                    checked={sensors.length > 0 && selectedSensors.length === sensors.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleSelectAll();
                      } else {
                        handleDeselectAll();
                      }
                    }}
                  />
                  <label htmlFor="selectAll" className="text-sm font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none">
                    Select All ({selectedSensors.length}/{sensors.length})
                  </label>
                </div>
              </div>

              <div className="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
                <button onClick={() => setSortOption('popularity')} className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${sortOption === 'popularity' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>🔥 인기순</button>
                <button onClick={() => setSortOption('price_asc')} className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${sortOption === 'price_asc' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>💰 낮은가격순</button>
                <button onClick={() => setSortOption('price_desc')} className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${sortOption === 'price_desc' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>💎 높은가격순</button>
              </div>
            </div>

            <div className="overflow-y-auto px-4 pb-4 space-y-3 flex-1 custom-scrollbar">
              {sensors.map((sensor) => {
                const isSelected = selectedSensors.find(s => s.model === sensor.model);
                return (
                  <button
                    key={sensor.model}
                    onClick={() => toggleSensor(sensor)}
                    className={`w-full text-left p-4 rounded-2xl transition-all duration-300 group relative overflow-hidden flex items-start -z-0 ${isSelected
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-200 scale-[1.02]'
                      : 'bg-white/40 hover:bg-white/80 hover:shadow-sm text-slate-700 hover:scale-[1.01]'
                      }`}
                  >
                    <div className={`mr-3 mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'border-white bg-white text-indigo-600' : 'border-slate-400 bg-transparent'}`}>
                      {isSelected && <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </div>
                    <div className="flex-1">
                      <span className={`block font-bold text-lg mb-1 leading-snug ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                        {sensor.model}
                      </span>
                      <div className="flex justify-between items-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>
                          {sensor.type}
                        </span>
                        {sensor.price && sensor.price !== "가격 정보 없음" && (
                          <span className={`text-sm font-bold tabular-nums ${isSelected ? 'text-indigo-100' : 'text-indigo-600'}`}>
                            ₩{sensor.price}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col gap-6 h-full min-h-0">

            <div className="glass-panel rounded-3xl p-6 h-[28%] min-h-[220px] flex flex-col overflow-hidden relative transition-all">
              {selectedSensors.length === 1 ? (
                <div className="animate-slide-up h-full flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h2 className="text-2xl font-black text-slate-800 mb-1">{selectedSensors[0].model}</h2>
                      <p className="text-sm text-slate-600 font-medium line-clamp-1">{selectedSensors[0].description}</p>
                    </div>
                    <div className="bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100 hidden lg:block">
                      <span className="text-indigo-600 font-bold text-xs">SINGLE</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 overflow-y-auto pb-2 custom-scrollbar pr-2 flex-1">
                    {selectedSensors[0].projects.map((p, i) => (
                      <div key={i} className="bg-white/60 p-3 rounded-xl border border-white hover:border-indigo-200 transition-all hover:shadow-md group flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center text-sm group-hover:scale-110 transition-transform">
                            {['🚀', '💡', '🛠️'][i % 3]}
                          </div>
                          <h3 className="font-bold text-slate-800 text-sm truncate">{p.title}</h3>
                        </div>
                        <p className="text-slate-600 text-xs leading-relaxed line-clamp-2">{p.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : selectedSensors.length > 1 ? (
                <div className="animate-slide-up h-full flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-xl font-black text-slate-800">Selected ({selectedSensors.length})</h2>
                    </div>
                    <div className="bg-purple-50 px-3 py-1 rounded-lg border border-purple-100 hidden lg:block">
                      <span className="text-purple-600 font-bold text-xs">MULTI</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 overflow-y-auto pb-2 custom-scrollbar pr-2 flex-1">
                    {selectedSensors.map((s, i) => (
                      <div key={i} className="bg-white/60 p-2.5 rounded-xl border border-white flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase">{s.type}</span>
                          <h3 className="font-bold text-slate-800 text-sm leading-tight mt-0.5 truncate">{s.model}</h3>
                        </div>
                        <div className="mt-1 text-right">
                          <span className="text-xs font-bold text-indigo-600">₩{s.price}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
                  <div className="w-12 h-12 bg-gradient-to-tr from-slate-200 to-white rounded-full flex items-center justify-center mb-2 shadow-inner">
                    <span className="text-2xl">👈</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-400">Select components</h3>
                </div>
              )}
            </div>

            <div className="glass-panel rounded-3xl flex-1 flex flex-col overflow-hidden relative border border-white/60">
              <div className="bg-white/30 backdrop-blur-sm p-4 border-b border-white/20">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-slate-700 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isDiscussing || isGenerating ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`}></span>
                    {discussionMode ? '🎭 Multi-Expert Discussion' : 'AI Engineering Assistant'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDiscussionMode(!discussionMode)}
                      className={`text-xs font-medium px-3 py-1 rounded-lg transition-all ${discussionMode
                        ? 'bg-purple-500 text-white shadow-lg shadow-purple-200'
                        : 'bg-white/50 text-slate-600 border border-white/50 hover:bg-purple-50'
                        }`}
                    >
                      {discussionMode ? '토론 모드 ON' : '토론 모드'}
                    </button>
                    <select
                      value={selectedModel}
                      onChange={(e) => handleSaveModel(e.target.value)}
                      className="text-xs font-medium text-slate-600 bg-white/50 border border-white/50 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
                    >
                      <option value="gemini-3-pro-preview">Gemini 3.0 Pro</option>
                      <option value="gemini-3-flash-preview">Gemini 3.0 Flash</option>
                    </select>
                    {chatHistory.length > 0 && (
                      <button
                        onClick={() => {
                          if (window.confirm('대화 내용을 모두 지우시겠습니까?')) {
                            setChatHistory([]);
                          }
                        }}
                        className="ml-2 text-xs text-slate-400 hover:text-red-500 underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                {discussionMode && (
                  <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-white/20">
                    <span className="text-xs text-slate-500">전문가:</span>
                    {customExperts.map(expert => (
                      <label key={expert.id} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedExperts.includes(expert.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedExperts(prev => [...prev, expert.id]);
                            } else {
                              setSelectedExperts(prev => prev.filter(id => id !== expert.id));
                            }
                          }}
                          className="w-3 h-3 rounded"
                        />
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: expert.color + '20', color: expert.color }}>
                          {expert.name}
                        </span>
                      </label>
                    ))}
                    <span className="text-xs text-slate-400 ml-2">라운드:</span>
                    <select
                      value={discussionRounds}
                      onChange={(e) => setDiscussionRounds(Number(e.target.value))}
                      className="text-xs bg-white/50 border border-white/50 rounded px-1 py-0.5"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                    <button
                      onClick={() => setShowExpertEditor(true)}
                      className="text-xs text-purple-600 hover:text-purple-800 ml-2 underline"
                    >
                      ✏️ 편집
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={chatEndRef}>
                {chatHistory.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <p className="text-sm font-medium bg-white/50 px-4 py-2 rounded-full">
                      "Make a project idea using {selectedSensors.length > 0 ? `${selectedSensors.length} selected components` : 'Pico 2 W'}"
                    </p>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm backdrop-blur-sm ${msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : msg.role === 'error'
                        ? 'bg-red-50 text-red-600 border border-red-100'
                        : msg.role === 'expert'
                          ? `${msg.expertBgClass} rounded-bl-none border`
                          : 'bg-white/80 text-slate-800 rounded-bl-none border border-white'
                      }`}>
                      {msg.role === 'expert' && (
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b" style={{ borderColor: msg.expertColor + '40' }}>
                          <span className="text-sm font-bold" style={{ color: msg.expertColor }}>{msg.expertName}</span>
                        </div>
                      )}
                      {(msg.role === 'model' || msg.role === 'expert') ? (
                        <div className="prose prose-sm max-w-none prose-indigo prose-headings:font-bold prose-headings:text-slate-800 prose-p:text-slate-700 prose-a:text-indigo-600 prose-strong:text-slate-900 prose-ul:list-disc prose-ol:list-decimal">
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      )}
                    </div>
                  </div>
                ))}
                {isGenerating && (!chatHistory.length || chatHistory[chatHistory.length - 1].role !== 'model') && (
                  <div className="flex justify-start">
                    <div className="bg-white/70 px-6 py-4 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-3">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-.3s]"></div>
                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-.5s]"></div>
                      </div>
                      <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Thinking</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef}></div>
              </div>

              <div className="p-4 bg-white/40 border-t border-white/20">
                <div className="relative group">
                  <input
                    type="text"
                    className="w-full bg-white/80 border-0 rounded-2xl pl-6 pr-14 py-4 shadow-sm focus:ring-2 focus:ring-indigo-400/50 focus:bg-white transition-all placeholder:text-slate-400 text-slate-700 font-medium"
                    placeholder={discussionMode ? "전문가들에게 질문하세요..." : "Ask anything about your project..."}
                    disabled={!apiKey || isGenerating || isDiscussing}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && !isGenerating && !isDiscussing && chatInput.trim()) {
                        e.preventDefault();
                        discussionMode ? handleStartDiscussion() : handleSendMessage();
                      }
                    }}
                  />
                  <button
                    onClick={discussionMode ? handleStartDiscussion : handleSendMessage}
                    className={`absolute right-2 top-2 p-2 text-white rounded-xl transition shadow-md disabled:opacity-50 ${discussionMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    disabled={!apiKey || isGenerating || isDiscussing || !chatInput.trim()}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 transform -rotate-45 relative left-0.5 bottom-0.5">
                      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

          </main>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-lg animate-slide-up relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 to-purple-500"></div>

            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800">Setup API Access</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <p className="text-sm text-slate-600 mb-2">
                To enable the AI Brainstorming features, you need a Google Gemini API Key.
              </p>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" className="inline-flex items-center text-indigo-600 font-bold text-sm hover:underline">
                Get your free key here <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 ml-1"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </a>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">API Key</label>
                <input
                  type="password"
                  placeholder="Paste your key starting with AIza..."
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none font-mono text-sm"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              <button
                onClick={handleSaveKey}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-xl transform hover:-translate-y-0.5 transition-all"
              >
                Connect & Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expert Editor Modal */}
      {showExpertEditor && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">🎭 전문가 페르소나 편집</h2>
              <button onClick={() => setShowExpertEditor(false)} className="text-slate-400 hover:text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {customExperts.map((expert, idx) => (
                <div key={idx} className="p-4 rounded-xl border" style={{ borderColor: expert.color + '40', backgroundColor: expert.color + '10' }}>
                  <div className="flex gap-3 mb-3">
                    <input
                      type="text"
                      value={expert.name}
                      onChange={(e) => {
                        const updated = [...customExperts];
                        updated[idx].name = e.target.value;
                        setCustomExperts(updated);
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold"
                      placeholder="전문가 이름 (예: 🔧 하드웨어 전문가)"
                    />
                    <input
                      type="color"
                      value={expert.color}
                      onChange={(e) => {
                        const updated = [...customExperts];
                        updated[idx].color = e.target.value;
                        setCustomExperts(updated);
                      }}
                      className="w-10 h-10 rounded-lg cursor-pointer"
                    />
                  </div>
                  <textarea
                    value={expert.systemPrompt}
                    onChange={(e) => {
                      const updated = [...customExperts];
                      updated[idx].systemPrompt = e.target.value;
                      setCustomExperts(updated);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs leading-relaxed"
                    rows={3}
                    placeholder="시스템 프롬프트 (전문가의 역할과 성격을 설명)"
                  />
                  <button
                    onClick={() => {
                      setCustomExperts(prev => prev.filter((_, i) => i !== idx));
                      setSelectedExperts(prev => prev.filter(id => id !== expert.id));
                    }}
                    className="mt-2 text-xs text-red-500 hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  const newId = `expert_${Date.now()}`;
                  setCustomExperts(prev => [...prev, {
                    id: newId,
                    name: '🆕 새 전문가',
                    color: '#6366f1',
                    bgClass: 'bg-indigo-50 border-indigo-200',
                    systemPrompt: '너는 [분야] 전문가야. [역할]에 대해 전문적으로 조언해.'
                  }]);
                  setSelectedExperts(prev => [...prev, newId]);
                }}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition"
              >
                + 전문가 추가
              </button>
              <button
                onClick={() => {
                  setCustomExperts(EXPERTS);
                  setSelectedExperts(['hardware', 'software', 'cost']);
                }}
                className="py-2 px-4 text-slate-500 hover:text-slate-700 text-sm"
              >
                기본값 복원
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
