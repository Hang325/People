// 初始化 GUN
const gun = Gun({
    localStorage: true, // 啟用本地存儲
    peers: [], // 不使用外部 peers
    radisk: false, // 禁用磁碟存儲
    file: false, // 禁用檔案存儲
    multicast: true // 啟用多播以支援本地網路
});

// 添加連接狀態監聽
gun.on('hi', peer => {
    console.log('Connected to peer:', peer);
});

gun.on('bye', peer => {
    console.log('Disconnected from peer:', peer);
});

// 創建一個新的房間ID或使用現有的
const roomId = window.location.hash.slice(1) || Math.random().toString(36).substring(7);
window.location.hash = roomId;

// 創建共享資料的節點，加入房間ID以隔離不同房間的數據
const space = gun.get('creative-space-' + roomId);
const users = space.get('users');
const canvas = space.get('canvas');
const text = space.get('text');
const chat = space.get('chat');

// DOM 元素
const usernameInput = document.getElementById('username');
const usersList = document.getElementById('users-list');
const drawingBoard = document.getElementById('drawing-board');
const textArea = document.getElementById('text-area');
const textTool = document.getElementById('text-tool');
const drawTool = document.getElementById('draw-tool');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const brushSizeLabel = document.getElementById('brush-size-label');
const clearCanvas = document.getElementById('clear-canvas');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-message');
const sendMessage = document.getElementById('send-message');
const penTool = document.getElementById('pen-tool');
const eraserTool = document.getElementById('eraser-tool');
const rectTool = document.getElementById('rect-tool');
const circleTool = document.getElementById('circle-tool');
const fillTool = document.getElementById('fill-tool');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const downloadBtn = document.getElementById('download');

// 繪圖相關變數
const ctx = drawingBoard.getContext('2d');
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// 繪圖狀態和歷史記錄
let currentTool = 'pen';
const drawHistory = [];
let historyIndex = -1;
let isDrawingShape = false;
let startX = 0;
let startY = 0;
let tempCanvas = null;
let tempCtx = null;
let isMouseDown = false;

// 用戶相關
let username = '';
let lastActive = Date.now();

// 節流函數
function throttle(func, limit) {
    let inThrottle;
    let lastArgs;
    return function(...args) {
        lastArgs = args;
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => {
                if (lastArgs !== args) {
                    func.apply(this, lastArgs);
                }
                inThrottle = false;
            }, limit);
        }
    };
}

// 使用節流的筆畫同步函數
const throttledSyncStroke = throttle((strokeData) => {
    canvas.get('strokes').set({
        ...strokeData,
        timestamp: Date.now()
    });
}, 50); // 每 50ms 最多同步一次

// 修改畫布狀態同步
const throttledStateSync = throttle((state) => {
    canvas.get('state').put(state);
}, 1000); // 每秒最多同步一次完整畫布狀態

// 修改聊天訊息處理
const throttledChatUpdate = throttle((messageDiv) => {
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}, 100); // 每 100ms 最多更新一次

// 臨時畫布初始化
function initTempCanvas() {
    tempCanvas = document.createElement('canvas');
    tempCanvas.width = drawingBoard.width;
    tempCanvas.height = drawingBoard.height;
    tempCtx = tempCanvas.getContext('2d');
}

// 初始化畫布
function initCanvas() {
    const container = drawingBoard.parentElement;
    const maxWidth = 1920; // 設定最大寬度以限制記憶體使用
    const maxHeight = 1080;
    
    // 計算適當的畫布大小
    let width = Math.min(container.clientWidth, maxWidth);
    let height = Math.min(container.clientHeight, maxHeight);
    
    drawingBoard.width = width;
    drawingBoard.height = height;
    
    // 設定 willReadFrequently 屬性以優化效能
    const ctx = drawingBoard.getContext('2d', { willReadFrequently: true });
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, drawingBoard.width, drawingBoard.height);
    updateDrawingSettings();
    initTempCanvas();
    
    // 初始化時不需要立即保存狀態
    drawHistory.length = 0;
    historyIndex = -1;
    
    // 建立初始狀態的縮圖
    createHistoryThumbnail();
}

// 建立歷史記錄縮圖
function createHistoryThumbnail() {
    const thumbnailCanvas = document.createElement('canvas');
    const scale = 0.25; // 縮小到原始大小的 25%
    thumbnailCanvas.width = drawingBoard.width * scale;
    thumbnailCanvas.height = drawingBoard.height * scale;
    
    const thumbCtx = thumbnailCanvas.getContext('2d');
    thumbCtx.scale(scale, scale);
    thumbCtx.drawImage(drawingBoard, 0, 0);
    
    return thumbnailCanvas;
}

// 更新繪圖設定
function updateDrawingSettings() {
    if (currentTool === 'eraser') {
        ctx.strokeStyle = '#ffffff';
    } else {
        ctx.strokeStyle = colorPicker.value;
    }
    ctx.lineWidth = brushSize.value;
    ctx.lineCap = 'round';
    brushSizeLabel.textContent = `${brushSize.value}px`;
}

// 工具選擇
function selectTool(toolId) {
    const tools = ['pen-tool', 'eraser-tool', 'rect-tool', 'circle-tool', 'fill-tool'];
    tools.forEach(tool => {
        document.getElementById(tool).classList.remove('active');
    });
    document.getElementById(toolId).classList.add('active');
    currentTool = toolId.replace('-tool', '');
    
    // 重置繪圖狀態
    isDrawing = false;
    isDrawingShape = false;
    isMouseDown = false;
    
    // 更新工具設定
    updateDrawingSettings();
}

// 工具事件監聽器
penTool.addEventListener('click', () => selectTool('pen-tool'));
eraserTool.addEventListener('click', () => selectTool('eraser-tool'));
rectTool.addEventListener('click', () => selectTool('rect-tool'));
circleTool.addEventListener('click', () => selectTool('circle-tool'));
fillTool.addEventListener('click', () => selectTool('fill-tool'));

// 保存畫布狀態
function saveState() {
    try {
        const thumbnail = createHistoryThumbnail();
        
        if (historyIndex < drawHistory.length - 1) {
            drawHistory.splice(historyIndex + 1);
        }
        
        if (drawHistory.length >= 50) {
            drawHistory.shift();
            historyIndex--;
        }
        
        drawHistory.push(thumbnail);
        historyIndex++;
        updateUndoRedoButtons();
        
        // 使用節流後的狀態同步
        throttledStateSync({
            data: drawingBoard.toDataURL('image/jpeg', 0.5),
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('保存狀態時發生錯誤:', error);
        updateUndoRedoButtons();
    }
}

// 更新復原/重做按鈕狀態
function updateUndoRedoButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= drawHistory.length - 1;
}

// 復原功能
undoBtn.addEventListener('click', () => {
    if (historyIndex > 0) {
        historyIndex--;
        const thumbnail = drawHistory[historyIndex];
        
        // 從縮圖恢復畫布狀態
        ctx.clearRect(0, 0, drawingBoard.width, drawingBoard.height);
        ctx.drawImage(thumbnail, 0, 0, drawingBoard.width, drawingBoard.height);
        
        updateUndoRedoButtons();
    }
});

// 重做功能
redoBtn.addEventListener('click', () => {
    if (historyIndex < drawHistory.length - 1) {
        historyIndex++;
        const thumbnail = drawHistory[historyIndex];
        
        // 從縮圖恢復畫布狀態
        ctx.clearRect(0, 0, drawingBoard.width, drawingBoard.height);
        ctx.drawImage(thumbnail, 0, 0, drawingBoard.width, drawingBoard.height);
        
        updateUndoRedoButtons();
    }
});

// 下載功能
downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = '我的創作.png';
    link.href = drawingBoard.toDataURL();
    link.click();
});

// 用戶名稱處理
usernameInput.addEventListener('change', (e) => {
    username = e.target.value;
    if (username) {
        updateUserStatus(true);
    }
});

// 定期更新用戶在線狀態
function updateUserStatus(isOnline) {
    if (username) {
        users.get(username).put({
            online: isOnline,
            lastActive: Date.now()
        });
    }
}

// 每30秒更新一次在線狀態
setInterval(() => updateUserStatus(true), 30000);

// 在頁面關閉時更新狀態
window.addEventListener('beforeunload', () => {
    updateUserStatus(false);
});

// 更新在線用戶列表
users.map().on((user, id) => {
    if (user) {
        let userElement = document.getElementById(`user-${id}`);
        if (!userElement) {
            userElement = document.createElement('li');
            userElement.id = `user-${id}`;
            usersList.appendChild(userElement);
        }
        userElement.textContent = id;
        userElement.className = user.online ? 'online' : '';
        
        // 移除長時間不活躍的用戶
        if (!user.online && Date.now() - user.lastActive > 5 * 60 * 1000) {
            userElement.remove();
        }
    }
});

// 獲取滑鼠在畫布上的相對位置
function getMousePos(e) {
    const rect = drawingBoard.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

// 獲取觸控位置
function getTouchPos(touch) {
    const rect = drawingBoard.getBoundingClientRect();
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
    };
}

// 開始繪圖
function startDrawing(e) {
    if (e.button !== 0) return; // 只處理左鍵點擊
    
    isMouseDown = true;
    isDrawing = true;
    const pos = getMousePos(e);
    [lastX, lastY] = [pos.x, pos.y];
    [startX, startY] = [pos.x, pos.y];

    if (currentTool === 'fill') {
        floodFill(startX, startY, colorPicker.value);
    } else if (['rect', 'circle'].includes(currentTool)) {
        isDrawingShape = true;
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(drawingBoard, 0, 0);
    }
}

// 繪圖過程
function draw(e) {
    if (!isMouseDown || !isDrawing) return;
    
    const pos = getMousePos(e);
    const currentX = Math.min(Math.max(pos.x, 0), drawingBoard.width);
    const currentY = Math.min(Math.max(pos.y, 0), drawingBoard.height);

    if (['rect', 'circle'].includes(currentTool)) {
        // 繪製形狀預覽
        ctx.clearRect(0, 0, drawingBoard.width, drawingBoard.height);
        ctx.drawImage(tempCanvas, 0, 0);
        
        if (currentTool === 'rect') {
            drawRect(startX, startY, currentX - startX, currentY - startY);
        } else if (currentTool === 'circle') {
            drawCircle(startX, startY, currentX, currentY);
        }
    } else if (['pen', 'eraser'].includes(currentTool)) {
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        
        throttledSyncStroke({
            fromX: lastX,
            fromY: lastY,
            toX: currentX,
            toY: currentY,
            color: ctx.strokeStyle,
            width: ctx.lineWidth,
            tool: currentTool
        });
    }
    
    [lastX, lastY] = [currentX, currentY];
}

// 結束繪圖
function stopDrawing(e) {
    if (!isMouseDown) return;
    
    isMouseDown = false;
    if (isDrawing && ['rect', 'circle'].includes(currentTool)) {
        const pos = getMousePos(e);
        // 最後一次更新形狀位置
        const finalX = Math.min(Math.max(pos.x, 0), drawingBoard.width);
        const finalY = Math.min(Math.max(pos.y, 0), drawingBoard.height);
        
        if (currentTool === 'rect') {
            drawRect(startX, startY, finalX - startX, finalY - startY);
        } else if (currentTool === 'circle') {
            drawCircle(startX, startY, finalX, finalY);
        }
        saveState();
    }
    isDrawing = false;
    isDrawingShape = false;
}

// 繪製矩形
function drawRect(x, y, width, height) {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.stroke();
}

// 繪製圓形
function drawCircle(startX, startY, endX, endY) {
    const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    ctx.beginPath();
    ctx.arc(startX, startY, radius, 0, Math.PI * 2);
    ctx.stroke();
}

// 填充功能
function floodFill(startX, startY, fillColor) {
    const imageData = ctx.getImageData(0, 0, drawingBoard.width, drawingBoard.height);
    const pixels = imageData.data;
    
    const startPos = (startY * drawingBoard.width + startX) * 4;
    const startR = pixels[startPos];
    const startG = pixels[startPos + 1];
    const startB = pixels[startPos + 2];
    const startA = pixels[startPos + 3];
    
    const fillColorRGB = hexToRgb(fillColor);
    
    function matchesStart(pos) {
        return pixels[pos] === startR &&
            pixels[pos + 1] === startG &&
            pixels[pos + 2] === startB &&
            pixels[pos + 3] === startA;
    }
    
    function colorPixel(pos) {
        pixels[pos] = fillColorRGB.r;
        pixels[pos + 1] = fillColorRGB.g;
        pixels[pos + 2] = fillColorRGB.b;
        pixels[pos + 3] = 255;
    }
    
    const pixelsToCheck = [startPos];
    while (pixelsToCheck.length > 0) {
        const pos = pixelsToCheck.pop();
        const x = (pos / 4) % drawingBoard.width;
        const y = Math.floor((pos / 4) / drawingBoard.width);
        
        if (matchesStart(pos)) {
            colorPixel(pos);
            
            if (x > 0) pixelsToCheck.push(pos - 4);
            if (x < drawingBoard.width - 1) pixelsToCheck.push(pos + 4);
            if (y > 0) pixelsToCheck.push(pos - drawingBoard.width * 4);
            if (y < drawingBoard.height - 1) pixelsToCheck.push(pos + drawingBoard.width * 4);
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    saveState();
}

// 將十六進制顏色轉換為RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// 接收其他用戶的繪圖數據
canvas.get('strokes').map().on((stroke) => {
    if (stroke && stroke.timestamp) {
        ctx.beginPath();
        ctx.strokeStyle = stroke.color || '#000000';
        ctx.lineWidth = stroke.width || 2;
        ctx.moveTo(stroke.fromX, stroke.fromY);
        ctx.lineTo(stroke.toX, stroke.toY);
        ctx.stroke();
        
        // 恢復當前用戶的設定
        updateDrawingSettings();
    }
});

// 接收聊天訊息
chat.map().on((data) => {
    if (data && data.timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.innerHTML = `<span class="username">${data.user}:</span> ${data.message}`;
        throttledChatUpdate(messageDiv);
    }
});

// 同步整個畫布狀態
canvas.get('state').on((data) => {
    if (data && data.data && data.timestamp) {
        const img = new Image();
        img.onload = () => {
            try {
                ctx.clearRect(0, 0, drawingBoard.width, drawingBoard.height);
                ctx.drawImage(img, 0, 0, drawingBoard.width, drawingBoard.height);
                createHistoryThumbnail(); // 建立新的歷史記錄
            } catch (error) {
                console.error('載入畫布狀態時發生錯誤:', error);
            }
        };
        img.src = data.data;
    }
});

// 清除畫布
function clearCanvasAndReset() {
    // 清除主畫布
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, drawingBoard.width, drawingBoard.height);
    
    // 清除臨時畫布
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // 重置繪圖狀態
    isDrawing = false;
    isDrawingShape = false;
    
    // 更新歷史記錄
    saveState();
    
    // 發送清除事件給其他用戶
    canvas.get('clear').put({ timestamp: Date.now() });
}

// 清除畫布按鈕事件
clearCanvas.addEventListener('click', clearCanvasAndReset);

// 監聽畫布清除事件
canvas.get('clear').on(data => {
    if (data && data.timestamp) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, drawingBoard.width, drawingBoard.height);
        saveState();
    }
});

// 顏色和筆刷大小變更
colorPicker.addEventListener('input', updateDrawingSettings);
brushSize.addEventListener('input', updateDrawingSettings);

// 文字共享功能
textArea.addEventListener('input', (e) => {
    const newText = e.target.value;
    text.put({
        content: newText,
        timestamp: Date.now()
    });
});

// 接收其他用戶的文字更新
text.on((data) => {
    if (data && data.content && data.timestamp) {
        if (textArea.value !== data.content) {
            textArea.value = data.content;
        }
    }
});

// 聊天功能
function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message && username) {
        chat.set({
            user: username,
            message: message,
            timestamp: Date.now()
        });
        chatInput.value = '';
    }
}

sendMessage.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// 工具切換
textTool.addEventListener('click', () => {
    textArea.style.display = 'block';
    drawingBoard.style.display = 'none';
    document.querySelector('.drawing-controls').style.display = 'none';
});

drawTool.addEventListener('click', () => {
    textArea.style.display = 'none';
    drawingBoard.style.display = 'block';
    document.querySelector('.drawing-controls').style.display = 'flex';
});

// 滑鼠移出事件處理
function handleMouseOut(e) {
    stopDrawing();
    // 確保臨時畫布與主畫布同步
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(drawingBoard, 0, 0);
}

// 錯誤處理函數
function handleError(error) {
    console.error('錯誤:', error);
    // 可以在這裡添加使用者提示
}

// 初始化
window.addEventListener('load', () => {
    try {
        initCanvas();
        textArea.style.display = 'none';

        // 修改事件監聽器
        drawingBoard.addEventListener('mousedown', startDrawing);
        drawingBoard.addEventListener('mousemove', draw);
        document.addEventListener('mouseup', stopDrawing); // 改為監聽整個文檔
        drawingBoard.addEventListener('mouseleave', handleMouseOut);
        
        // 顏色選擇器事件監聽
        colorPicker.addEventListener('input', updateDrawingSettings); // 即時更新顏色
        colorPicker.addEventListener('change', updateDrawingSettings); // 確認顏色選擇
        
        // 防止在拖曳過程中選中文字
        drawingBoard.addEventListener('selectstart', (e) => e.preventDefault());

        // 觸控事件支援
        drawingBoard.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const pos = getTouchPos(touch);
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: pos.x + drawingBoard.getBoundingClientRect().left,
                clientY: pos.y + drawingBoard.getBoundingClientRect().top
            });
            drawingBoard.dispatchEvent(mouseEvent);
        });

        drawingBoard.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const pos = getTouchPos(touch);
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: pos.x + drawingBoard.getBoundingClientRect().left,
                clientY: pos.y + drawingBoard.getBoundingClientRect().top
            });
            drawingBoard.dispatchEvent(mouseEvent);
        });

        drawingBoard.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            drawingBoard.dispatchEvent(mouseEvent);
        });

        // 監聽視窗大小改變
        window.addEventListener('resize', () => {
            try {
                const container = drawingBoard.parentElement;
                const imageData = ctx.getImageData(0, 0, drawingBoard.width, drawingBoard.height);
                drawingBoard.width = container.clientWidth;
                drawingBoard.height = container.clientHeight;
                ctx.putImageData(imageData, 0, 0);
                tempCanvas.width = drawingBoard.width;
                tempCanvas.height = drawingBoard.height;
            } catch (error) {
                handleError(error);
            }
        });

        // 添加畫布以外區域的點擊事件
        document.addEventListener('click', (e) => {
            if (!drawingBoard.contains(e.target)) {
                isMouseDown = false;
            }
        });

    } catch (error) {
        handleError(error);
    }
});