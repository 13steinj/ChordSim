let canvas;
let context;
let ring;

window.onload = () => {
    console.log("wh");
    canvas = document.getElementById('sim');
    console.log(canvas);
    context = canvas.getContext('2d');
    ring = new Ring(canvas.width / 3, canvas.width / 2,
                    canvas.height / 2, 3, "#000", 32, 0.18);
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


class Circle extends Drawable {
    constructor(radius, x, y, width, strokeStyle, fillStyle, strokeDash) {
        super();
        this.radius = radius;
        this.x = x;
        this.y = y
        this.width = width;
        this.strokeStyle = strokeStyle;
        this.fillStyle = fillStyle;
        this.strokeDash = strokeDash || [];
    }
    draw() {
        context.beginPath();
        context.arc(this.x, this.y, this.radius, 2 * Math.PI, false);
        context.lineWidth = 3;
        context.strokeStyle = this.strokeStyle;
        context.fillStyle = this.fillStyle;
        if (this.fillStyle !== undefined) context.fill();
        context.setLineDash(this.strokeDash);
        context.stroke();
    }
};


class Node extends Circle {
    constructor(id, ring, has_data, fake) {
        let theta = -Math.PI * (1 / 2 + 2 * id / ring.size);
        let x = ring.x - ring.radius * Math.cos(theta);
        let y = ring.y + ring.radius * Math.sin(theta);
        super(ring.radius * Math.PI * 2 / (ring.size * 3), x, y,
              3, "#000", undefined, fake ? [1, 2] : []);
        this.has_data = has_data;
        this.fake = fake;

        let inscribed_side = this.radius * Math.SQRT2;
        let font_size = Math.floor(inscribed_side);
        let text_x = x - inscribed_side / 2;
        let text_y = y + inscribed_side / 2;
        let font = `${font_size}pt sans-serif`;
        this.text = new Text(id, text_x, text_y,
                             inscribed_side,
                             font, '#000');

        Object.defineProperty(this, "fillStyle", {
            get: function() {
                return this.has_data ? "#00FFFF" : "#FFF";
            }
        });
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
        this.node_arr = new Array(size);
        for (let i = 0; i < size; i++)
            this.node_arr[i] = new Node(
                i, this, Math.random() <= true_node_prop * 2,
                Math.random() >= true_node_prop);
    }
    draw() {
        super.draw();
        this.node_arr.forEach(node => node !== undefined && node.draw());
    }
};
