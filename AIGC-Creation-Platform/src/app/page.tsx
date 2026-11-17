import { redirect } from 'next/navigation';

// 根路径不做仪表盘：个人自用工具打开就该落在最常用的供应商页，少一次点击
export default function Home() {
  redirect('/providers');
}