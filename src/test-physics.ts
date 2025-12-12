import Matter from 'matter-js';

// 과일 크기별 데이터
const FRUIT_SIZES = [
  { size: 1, radius: 15, color: '#FF6B6B' },
  { size: 2, radius: 22, color: '#FF8E53' },
  { size: 3, radius: 30, color: '#FFCD56' },
  { size: 4, radius: 40, color: '#4BC0C0' },
  { size: 5, radius: 52, color: '#36A2EB' },
  { size: 6, radius: 65, color: '#9966FF' },
  { size: 7, radius: 80, color: '#FF6384' },
];

const DROP_Y = 80; // 드롭 위치 Y
const GAME_OVER_Y = 100; // 게임오버 라인

export function runPhysicsTest(canvas: HTMLCanvasElement) {
  const width = 400;
  const height = 600;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;

  // Matter.js 엔진 생성
  const engine = Matter.Engine.create();
  engine.world.gravity.y = 1;

  // 벽 생성
  const walls = [
    Matter.Bodies.rectangle(width / 2, height + 10, width + 40, 20, { isStatic: true, label: 'floor' }),
    Matter.Bodies.rectangle(-10, height / 2, 20, height * 2, { isStatic: true, label: 'wall' }),
    Matter.Bodies.rectangle(width + 10, height / 2, 20, height * 2, { isStatic: true, label: 'wall' }),
  ];
  Matter.Composite.add(engine.world, walls);

  // 게임 상태
  const fruits = new Map<number, Matter.Body>();
  let nextId = 0;
  let score = 0;
  let maxFruitSize = 1;

  // 턴 상태
  type TurnPhase = 'ready' | 'dropping' | 'settling';
  let turnPhase: TurnPhase = 'ready';
  let dropX = width / 2;
  let currentFruitSize = 1;
  let droppedFruit: Matter.Body | null = null;

  // 타이머
  const TURN_TIME = 10;
  let timeRemaining = TURN_TIME;
  let timerInterval: number | null = null;

  // 컨트롤 버튼 생성
  const controlsDiv = document.createElement('div');
  controlsDiv.style.cssText = 'display:flex; justify-content:center; gap:10px; margin-top:15px;';
  controlsDiv.innerHTML = `
    <button id="btn-left" style="width:80px;height:60px;font-size:24px;background:#4a4a6a;color:white;border:none;border-radius:12px;cursor:pointer;">&lt;</button>
    <button id="btn-drop" style="width:120px;height:60px;font-size:18px;background:#e94560;color:white;border:none;border-radius:12px;cursor:pointer;">DROP</button>
    <button id="btn-right" style="width:80px;height:60px;font-size:24px;background:#4a4a6a;color:white;border:none;border-radius:12px;cursor:pointer;">&gt;</button>
  `;
  canvas.parentElement?.appendChild(controlsDiv);

  const btnLeft = document.getElementById('btn-left')!;
  const btnRight = document.getElementById('btn-right')!;
  const btnDrop = document.getElementById('btn-drop')!;

  // 이동 관련
  let moveInterval: number | null = null;
  const MOVE_SPEED = 3;

  function startMoving(direction: 'left' | 'right') {
    if (moveInterval || turnPhase !== 'ready') return;
    moveOnce(direction);
    moveInterval = window.setInterval(() => moveOnce(direction), 16);
  }

  function stopMoving() {
    if (moveInterval) {
      clearInterval(moveInterval);
      moveInterval = null;
    }
  }

  function moveOnce(direction: 'left' | 'right') {
    if (turnPhase !== 'ready') return;
    const radius = FRUIT_SIZES[currentFruitSize - 1].radius;
    if (direction === 'left') {
      dropX = Math.max(radius + 4, dropX - MOVE_SPEED);
    } else {
      dropX = Math.min(width - radius - 4, dropX + MOVE_SPEED);
    }
  }

  // 버튼 이벤트
  btnLeft.addEventListener('pointerdown', (e) => { e.preventDefault(); startMoving('left'); });
  btnLeft.addEventListener('pointerup', stopMoving);
  btnLeft.addEventListener('pointerleave', stopMoving);

  btnRight.addEventListener('pointerdown', (e) => { e.preventDefault(); startMoving('right'); });
  btnRight.addEventListener('pointerup', stopMoving);
  btnRight.addEventListener('pointerleave', stopMoving);

  btnDrop.addEventListener('click', dropFruit);

  // 과일 생성 함수
  function createFruit(x: number, y: number, size: number, isStatic = false): Matter.Body {
    const data = FRUIT_SIZES[size - 1] || FRUIT_SIZES[0];
    const id = nextId++;

    const fruit = Matter.Bodies.circle(x, y, data.radius, {
      isStatic,
      restitution: 0.2,
      friction: 0.5,
      label: `fruit_${id}_${size}`,
    });

    Matter.Composite.add(engine.world, fruit);
    fruits.set(id, fruit);
    return fruit;
  }

  // 과일 제거 함수
  function removeFruit(id: number): void {
    const fruit = fruits.get(id);
    if (fruit) {
      Matter.Composite.remove(engine.world, fruit);
      fruits.delete(id);
    }
  }

  // label에서 id와 size 추출
  function parseFruitLabel(label: string): { id: number; size: number } | null {
    const match = label.match(/^fruit_(\d+)_(\d+)$/);
    if (match) {
      return { id: parseInt(match[1]), size: parseInt(match[2]) };
    }
    return null;
  }

  // 타이머 시작
  function startTimer() {
    stopTimer();
    timeRemaining = TURN_TIME;
    timerInterval = window.setInterval(() => {
      timeRemaining--;
      if (timeRemaining <= 0) {
        // 시간 초과 - 자동 드롭
        dropFruit();
      }
    }, 1000);
  }

  // 타이머 정지
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // 드롭 함수
  function dropFruit() {
    if (turnPhase !== 'ready') return;

    stopTimer();
    turnPhase = 'dropping';
    droppedFruit = createFruit(dropX, DROP_Y, currentFruitSize, false);

    // settling 상태로 전환
    turnPhase = 'settling';
  }

  // 다음 턴 준비
  function nextTurn() {
    // 다음 과일 크기 결정 (maxFruitSize-1까지, 최대 5)
    const maxSpawn = Math.min(Math.max(1, maxFruitSize - 1), 5);
    currentFruitSize = Math.floor(Math.random() * maxSpawn) + 1;
    dropX = width / 2;
    droppedFruit = null;
    turnPhase = 'ready';
    startTimer();
  }

  // 과일이 안정됐는지 체크
  function checkSettled(): boolean {
    if (!droppedFruit) return true;
    const speed = Matter.Vector.magnitude(droppedFruit.velocity);
    const angularSpeed = Math.abs(droppedFruit.angularVelocity);
    return speed < 0.3 && angularSpeed < 0.03;
  }

  // 충돌 감지 - 같은 크기 과일 합치기
  const mergedPairs = new Set<string>();

  Matter.Events.on(engine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
      const fruitA = parseFruitLabel(pair.bodyA.label);
      const fruitB = parseFruitLabel(pair.bodyB.label);

      if (!fruitA || !fruitB) continue;
      if (fruitA.size !== fruitB.size) continue;

      const pairKey = [fruitA.id, fruitB.id].sort().join('-');
      if (mergedPairs.has(pairKey)) continue;
      mergedPairs.add(pairKey);

      setTimeout(() => {
        const bodyA = fruits.get(fruitA.id);
        const bodyB = fruits.get(fruitB.id);

        if (!bodyA || !bodyB) return;

        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;
        const newSize = Math.min(fruitA.size + 1, FRUIT_SIZES.length);

        removeFruit(fruitA.id);
        removeFruit(fruitB.id);

        const newFruit = createFruit(midX, midY, newSize, false);

        // 점수 추가
        score += newSize * 10;

        // 최대 크기 업데이트
        if (newSize > maxFruitSize) {
          maxFruitSize = newSize;
        }

        // 드롭한 과일이 합쳐졌으면 새 과일로 교체
        if (droppedFruit === bodyA || droppedFruit === bodyB) {
          droppedFruit = newFruit;
        }

        mergedPairs.delete(pairKey);
      }, 0);
    }
  });

  // settling 체크 타이머
  let settleCheckTimer = 0;

  // 게임 루프
  function gameLoop() {
    Matter.Engine.update(engine, 1000 / 60);

    // settling 상태에서 안정화 체크
    if (turnPhase === 'settling') {
      settleCheckTimer++;
      // 최소 30프레임(0.5초) 대기 후 체크
      if (settleCheckTimer > 30 && checkSettled()) {
        settleCheckTimer = 0;
        nextTurn();
      }
    }

    // 렌더링
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // 벽 그리기
    ctx.fillStyle = '#333';
    ctx.fillRect(0, height - 4, width, 4);
    ctx.fillRect(0, 0, 4, height);
    ctx.fillRect(width - 4, 0, 4, height);

    // 게임오버 라인
    ctx.strokeStyle = '#e94560';
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(0, GAME_OVER_Y);
    ctx.lineTo(width, GAME_OVER_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 드롭 가이드라인
    if (turnPhase === 'ready') {
      ctx.strokeStyle = '#ffffff44';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(dropX, DROP_Y);
      ctx.lineTo(dropX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 프리뷰 과일 (ready 상태일 때)
    if (turnPhase === 'ready') {
      const data = FRUIT_SIZES[currentFruitSize - 1];
      ctx.beginPath();
      ctx.arc(dropX, DROP_Y, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(currentFruitSize.toString(), dropX, DROP_Y);
    }

    // 과일 그리기
    for (const [, fruit] of fruits) {
      const { x, y } = fruit.position;
      const parsed = parseFruitLabel(fruit.label);
      if (!parsed) continue;

      const data = FRUIT_SIZES[parsed.size - 1] || FRUIT_SIZES[0];

      ctx.beginPath();
      ctx.arc(x, y, data.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, data.radius * 0.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(parsed.size.toString(), x, y);
    }

    // UI
    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${score}`, 10, 25);
    ctx.textAlign = 'right';
    ctx.fillText(`Fruits: ${fruits.size}`, width - 10, 25);

    // 타이머 표시
    ctx.textAlign = 'center';
    if (turnPhase === 'ready') {
      // 타이머 배경
      ctx.fillStyle = timeRemaining <= 3 ? '#e94560' : 'rgba(233, 69, 96, 0.8)';
      ctx.beginPath();
      ctx.roundRect(width / 2 - 30, 35, 60, 30, 8);
      ctx.fill();

      // 타이머 숫자
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px Arial';
      ctx.fillText(`${timeRemaining}`, width / 2, 55);
    } else if (turnPhase === 'settling') {
      ctx.fillStyle = '#FFCD56';
      ctx.font = '16px Arial';
      ctx.fillText('Waiting...', width / 2, 50);
    }

    requestAnimationFrame(gameLoop);
  }

  // 첫 턴 시작
  nextTurn();
  gameLoop();
}
