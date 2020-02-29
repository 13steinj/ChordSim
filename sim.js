let canvas;
let context;
let ring;
let min_dim;
let windowChangeDetector;

let dimChangeThreshold = 2;
let getCurrentMinDim = () =>
    Math.min(document.body.clientWidth,
             document.body.clientHeight) * 0.95;

let drawQueue = Promise.resolve();

window.onload = () => {
    // set up initial values, then create event for resizing the canvas
    drawQueue.then(() => {
        canvas = document.getElementById('sim');
        min_dim = getCurrentMinDim();
        canvas.setAttribute("width", min_dim);
        canvas.setAttribute("height", min_dim);
        context = canvas.getContext('2d');
        ring = new Ring(4 / 9, 1 / 2, 1 / 2, 3, "#000", 32, 0.18);
        ring.draw();
        windowChangeDetector = new function() {
            this.last_min_dim = min_dim;
            this.watch = () => {
                cancelAnimationFrame(this.watcher);
                let nmin_dim = getCurrentMinDim();
                if (Math.abs(this.last_min_dim - nmin_dim) >= dimChangeThreshold) {
                    min_dim = nmin_dim;
                    canvas.setAttribute("width", min_dim);
                    canvas.setAttribute("height", min_dim);
                    drawQueue.then(() => {
                        context.clearRect(0, 0, canvas.width, canvas.height);
                        ring.draw();
                    });
                }
                this.last_min_dim = nmin_dim;
                this.watcher = requestAnimationFrame(this.watch);
            };
            this.watcher = window.requestAnimationFrame(this.watch);
        };
    });
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
        super(Math.PI * 2 / (ring.size * 3), Math.cos(theta), Math.sin(theta),
              3, undefined, [[], [1, 2]], ["#FFF", "#00FFFF"]);
        this.has_data = false;
        this.fake = true;
        this.id = id;


        this.ring = ring;
        this.path_theta = theta;
    }

    get text() {
        // eh, fast enough, If needed to be faster, Text can be subclassed to NodeLabel
        // and then use ratio-based properties there
        let inscribed_side = this.radius * Math.SQRT2;
        let font_size = Math.floor(inscribed_side);
        let text_x = this.x - inscribed_side / 2;
        let text_y = this.y + inscribed_side / 2;
        let font = `${font_size}pt sans-serif`;
        return new Text(this.id, text_x, text_y,
                        inscribed_side,
                        font, '#000');
    }

    get radius() { return this.radius_scale * this.ring.radius; }
    set radius(v) { this.radius_scale = v; }

    get x() { return this.ring.x - this.ring.radius * this.x_scale; }
    set x(v) { this.x_scale = v; }

    get y() { return this.ring.y + this.ring.radius * this.y_scale; }
    set y(v) { this.y_scale = v; }


    get strokeDash() { return this.__strokeDash[+this.fake]; }
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
        if (!this.fake) return console.error("Already joined");
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
        drawQueue.then(() => this.draw());
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

    finger_table() {
        if (this.fake) return console.error("Non-joined node");
        return console.table(this.fingers.map((node, idx) => {
            return {
                "start": this._start(idx),
                "successor": node.id
            };
        }));
    }

    update_finger_table(s, i) {
        // deviation from Chord Paper: set is open on the left end.
        // Why the paper has a closed set, I do not know.
        // I can only guess that they did not double check their math,
        // since in their own simulators they use the non-aggressive stabilization-join method.
        // this is INCOMPLETE. The correct identifiers need to be found.
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

    get radius() { return this.radius_ratio * min_dim; }
    set radius(v) { this.radius_ratio = v; }
    get x() { return this.x_ratio * min_dim; }
    set x(v) { this.x_ratio = v; }
    get y() { return this.y_ratio * min_dim; }
    set y(v) { this.y_ratio = v; }

    has_real_node(id) { return !this.nodes[id].fake; }

    draw() {
        super.draw();
        this.nodes.forEach(node => node !== undefined && node.draw());
    }
};

