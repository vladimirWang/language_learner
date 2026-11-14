import helloThumb from "../assets/thumbs/hello.png";
import appleThumb from "../assets/thumbs/apple.png";
import bananaThumb from "../assets/thumbs/banana.png";
import milkThumb from "../assets/thumbs/milk.png";
import standUpThumb from "../assets/thumbs/stand-up.png";
import sitDownThumb from "../assets/thumbs/sit-down.png";
import handsUpThumb from "../assets/thumbs/hands-up.png";
import handsDownThumb from "../assets/thumbs/hands-down.png";

export type Level = {
  id: string;
  word: string;
  zh: string;
  tip: string;
  thumb: string;
  accent: string;
};

export const LEVELS: Level[] = [
  {
    id: "hello",
    word: "hello",
    zh: "你好",
    tip: "见到朋友挥挥手，大声说 Hello！",
    thumb: helloThumb,
    accent: "#2F86D6",
  },
  {
    id: "apple",
    word: "apple",
    zh: "苹果",
    tip: "红红的苹果又香又甜，Apple！",
    thumb: appleThumb,
    accent: "#E94B3C",
  },
  {
    id: "banana",
    word: "banana",
    zh: "香蕉",
    tip: "弯弯的香蕉像小船，Banana！",
    thumb: bananaThumb,
    accent: "#F2B01E",
  },
  {
    id: "milk",
    word: "milk",
    zh: "牛奶",
    tip: "每天喝一杯牛奶，身体棒棒！",
    thumb: milkThumb,
    accent: "#6FB1E0",
  },
  {
    id: "stand-up",
    word: "stand up",
    zh: "站起来",
    tip: "老师说 Stand up，我们就站起来。",
    thumb: standUpThumb,
    accent: "#FF8A3D",
  },
  {
    id: "sit-down",
    word: "sit down",
    zh: "坐下",
    tip: "老师说 Sit down，我们就坐下来。",
    thumb: sitDownThumb,
    accent: "#4FBF58",
  },
  {
    id: "hands-up",
    word: "hands up",
    zh: "举起手",
    tip: "想回答问题，就 Hands up 举起手！",
    thumb: handsUpThumb,
    accent: "#9B51E0",
  },
  {
    id: "hands-down",
    word: "hands down",
    zh: "放下手",
    tip: "说完啦，把小手 Hands down 放下来。",
    thumb: handsDownThumb,
    accent: "#1FB7C4",
  },
];

/** 彩虹字母配色，与设计图的高饱和糖果色接近 */
export const RAINBOW = [
  "#F2588E",
  "#FF8A3D",
  "#FFC531",
  "#4FBF58",
  "#2F86D6",
  "#9B51E0",
  "#1FB7C4",
];
