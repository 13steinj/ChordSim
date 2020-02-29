let canvas;
let context;
let ring;

let drawQueue = Promise.resolve();

window.onload = () => {
    canvas = document.getElementById('sim');
    let min_dim = Math.min(document.body.clientWidth, document.body.scrollHeight) * 0.9;
    canvas.setAttribute("width", min_dim);
    canvas.setAttribute("height", min_dim);
    context = canvas.getContext('2d');
    ring = new Ring(Math.min(min_dim * 4 / 9, min_dim * 4 / 9),
                    min_dim / 2, min_dim / 2, 3, "#000", 32, 0.18);
    ring.draw();
};

class Drawable {
    draw() { throw "Can't draw abstract drawable"; }
};

class Text extends Drawable {
    constructor(text, x, y, max_width, font, color) {
        super();
        this.text = text;
        this.x = x;
        this.y = y;
        this.max_width = max_width;
        this.font = font;
        this.color = color;
    }
    draw() {
        context.font = this.font;
        context.fillStyle = this.color;
        context.fillText(this.text, this.x, this.y, this.max_width);
    }
};

class Arc extends Drawable {
    constructor(radius, x, y, width, strokeStyle, strokeDash, theta) {
        super();
        this.radius = radius;
        this.x = x;
        this.y = y
        this.width = width;
        this.strokeStyle = strokeStyle;
        this.strokeDash = strokeDash || [];
        this.theta = theta;
    }
    draw() {
        context.beginPath();
        context.arc(this.x, this.y, this.radius, this.theta, false);
        context.lineWidth = 3;
        context.strokeStyle = this.strokeStyle;
        context.setLineDash(this.strokeDash);
        context.stroke();
    }
};

class Circle extends Arc {
    constructor(radius, x, y, width, strokeStyle, strokeDash, fillStyle) {
        super(radius, x, y, width, strokeStyle, strokeDash, 2 * Math.PI);
        this.fillStyle = fillStyle;
    }
    draw() {
        super.draw()
        context.fillStyle = this.fillStyle;
        if (this.fillStyle !== undefined) context.fill();
    }
};


class Node extends Circle {
    constructor(id, ring) {
        let theta = -Math.PI * (1 / 2 + 2 * id / ring.size);
        let x = ring.x - ring.radius * Math.cos(theta);
        let y = ring.y + ring.radius * Math.sin(theta);
        super(ring.radius * Math.PI * 2 / (ring.size * 3), x, y,
              3, undefined, [[], [1, 2]], ["#FFF", "#00FFFF"]);
        this.has_data = false;
        this.fake = true;
        this.id = id;

        let inscribed_side = this.radius * Math.SQRT2;
        let font_size = Math.floor(inscribed_side);
        let text_x = x - inscribed_side / 2;
        let text_y = y + inscribed_side / 2;
        let font = `${font_size}pt sans-serif`;
        this.text = new Text(id, text_x, text_y,
                             inscribed_side,
                             font, '#000');

        this.ring = ring;
        this.path_theta = theta;
    }

    get strokeDash() {
        return this.__strokeDash[+this.fake];
    }

    set strokeDash(v) { this.__strokeDash = v; }

    // This is based on two values. First is node blank, Second is has_data
    get fillStyle() { return this.__fillStyle[+this.has_data]; }
    set fillStyle(v) { this.__fillStyle = v; }

    // I want this to be unsettable from the outside world, sorry.
    get fingers() { return this.__fingers !== undefined ? this.__fingers : []; }

    // helper for calculating "ins". Done with <= always.
    // < op is done manually by adding or subtracting one to a bound
    static modular_in(x, lb, ub, modulos) {
        x = x instanceof Node ? x.id : x;
        lb = lb instanceof Node ? lb.id : lb;
        ub = ub instanceof Node ? ub.id : ub;
        modulos = modulos instanceof Ring ? modulos.size : modulos;
        if (ub <= lb)
            return (lb <= x && x < modulos) || (0 <= x && x <= ub);
        else
            return lb <= x && x <= ub;
    }

    // positive modulo, because I -1 in some cases, in case I have a -1.
    static pos_mod(x, modulos) { return (modulos + (x % modulos)) % modulos; }

    // get "start" value from finger table idx
    _start(fidx) { return this.id + (1 << fidx); }

    get successor() { return this.fingers[0]; }
    set successor(v) {
        this.__fingers = this.__fingers || [...Array(Math.log2(this.ring.size))];
        this.fingers[0] = v;
    }

    // Node joining, aggressive methodology from Chord SIGCOMM01 paper
    join(n_prime) { // n_prime is on the ring
        if (n_prime) {
            if (!this.ring.has_real_node(n_prime.id)) {
                return console.error("Node to join is not in ring");
            }
            this.init_finger_table(n_prime);
            this.update_others();
        } else {
            if (this.ring.nodes.find(x => !x.fake)) {
                return console.error("Can't reset ring, clear and recreate");
            }
            this.__fingers = [...Array(Math.log2(this.ring.size))].map(undef => this);
            this.predecessor = this;
        }
        this.fake = false;
    }

    init_finger_table(n_prime) {
        this.__fingers = [...Array(Math.log2(this.ring.size))];
        this.__fingers[0] = n_prime.find_successor(this._start(0));
        this.predecessor = this.successor.predecessor;
        this.successor.predecessor = this;
        this.__fingers.forEach((node, idx) => {
            if (!idx) return; // skip first
            if (Node.modular_in(
                    this._start(idx), this,
                    Node.pos_mod(this.__fingers[idx - 1].id - 1, this.ring.size),
                    this.ring.size)) {
                this.__fingers[idx] = this.__fingers[idx - 1];
            } else {
                this.__fingers[idx] = n_prime.find_successor(_start(idx));
            }
        });
    }

    update_others() {
        this.fingers.forEach((_, idx) => {
            this.find_predecessor(
                Node.pos_mod(
                    this.id - (1 << idx),
                    this.ring.size)
            ).update_finger_table(this, idx);
        });
    }

    log_ftable() {
        if (this.fake) return console.error("Non-joined node");
        return console.table(this.fingers.map((node, idx) => {
            return {
                "start": this._start(idx),
                "successor": node.id
            };
        }));
    }

    update_finger_table(s, i) {
        // deviation from Chord Paper: set is open on the left end. Why the paper has a closed set, I do not know. I can only guess that they did not double check their math, since in their own simulators they use the non-aggressive stabilization-join method.
        if (Node.modular_in(
                s, this.id + 1, Node.pos_mod(
                    this.fingers[i].id - 1, this.ring.size),
                this.ring.size)) {
            this.fingers[i] = s;
            this.predecessor.update_finger_table(s, i);
        }
    }

    find_successor(id) {
        return this.find_predecessor(id).successor;
    }

    find_predecessor(id) {
        let prime = this;
        while (!Node.modular_in(id,
                    Node.pos_mod(prime.id + 1, this.ring.size),
                    prime.successor,
                    this.ring.size)) {
            prime = prime.closest_preceding_finger(id);
        }
        return prime;
    }

    closest_preceding_finger(id) {
        for (let fidx = this.fingers.length - 1; fidx >= 0; fidx--) {
            if (Node.modular_in(
                    this.fingers[fidx],
                    Node.pos_mod(this.id + 1, this.ring.size),
                    Node.pos_mod(this.id - 1, this.ring.size),
                    this.ring.size)) {
                return this.fingers[fidx];
            }
        }
        return this;
    }

    populate_fingers() {
        this.__fingers = new Array(Math.log2(this.ring.size));
        for (let idx = 0; idx < this.__fingers.length; idx++) {
            for (let shift = 1 << idx; shift <= this.ring.size; shift++) {
                let ctry = this.ring.nodes[(this.id + shift) % this.ring.size];
                if (!ctry.fake) {
                    this.__fingers[idx] = ctry;
                    break;
                }
            }
        }
        if (this.__fingers.some(x => x === undefined))
            console.error("Damn my math for fingers is wrong");
    }

    keyInBounds(key, idx, lastShot) {
        let upper = this.fingers[idx].id;
        let second;
        if (idx || lastShot) {
            upper = [key, key = upper][0];
        }
        if (this.id >= upper) {
            upper = this.ring.size - 1;
            second = upper;
        }
        if (key < upper && key > this.id) return true;
        if (key < second && key >= 0) return true;
        return false;
    }

    fetch(key) {
        if (this.data.has(key)) {
            console.log(`${key} found at node ${this.id}`);
            return `${key}@${this.id}`
        }
        for (let idx = this.fingers.length; idx >= 0; idx--) {
            if (this.keyInBounds(key, idx % this.fingers.length, !idx)) {
                let modid = idx % this.fingers.length;
                console.log(`Passing on to ${this.fingers[modid].id}`);
                return this.fingers[modid].fetch(key);
            }
        }
        console.error(`${key} not found`);
        return undefined;
    }

    fetch2(key) {
        if (this.data.has(key)) {
            console.log(`${key} found at node ${this.id}`);
            return `${key}@${this.id}`
        }
        succ = this.find_successor(id);
        if (succ.data.has(key)) {
            console.log(`${key} found at node ${succ.id}`);
            return `${key}@${succ.id}`
        }
        console.error(`${key} not found`);
        return null;
    }

    draw() {
        super.draw();
        this.text.draw();
    }
};

class Ring extends Circle {
    constructor(radius, x, y, width, strokeStyle, size, true_node_prop) {
        super(radius, x, y, width, strokeStyle);
        this.size = size;
        this.nodes = [...Array(size)].map((_, idx) => new Node(idx, this));
    }

    has_real_node(id) { return !this.nodes[id].fake; }

    draw() {
        super.draw();
        this.nodes.forEach(node => node !== undefined && node.draw());
    }
};

