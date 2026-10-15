"""ยา รพ.สต. (ใช้ทั้งระบบ: กิน/ฉีด/พ่น/สารน้ำ) → รหัสยาใน DDInter (https://ddinter.scbdd.com · CC BY-NC-SA 4.0)
   ยาทาภายนอก/ยาป้ายปาก/ยาสมุนไพร ไม่รวม (interaction ใน DDInter เป็นของยาที่เข้าสู่ร่างกาย)"""
SYSTEMIC = ('ยาเม็ด', 'ยาผง', 'ยาน้ำรับประทาน', 'ยาฉีด', 'สารน้ำ', 'ยาพ่น', 'Emergency', 'NCD')
# ชื่อในบัญชียาหลัก → ชื่อใน DDInter (ไม่มีในตาราง = ใช้ชื่อแรกก่อนวงเล็บ หรือชื่อในวงเล็บ)
ALIAS = {
    'Sulfamethoxazole + Trimethoprim (Co-trimoxazole)': ['sulfamethoxazole', 'trimethoprim'],
    'Ipratropium bromide + Fenoterol hydrobromide': ['ipratropium'],
    'Dicycloverine hydrochloride (Dicyclomine hydrochloride)': ['dicyclomine'],
    'Ferrous sulfate': ['ferrous sulfate anhydrous'],
    'Ferrous salt + Folic acid + Potassium Iodide': ['iron', 'folic acid'],   # KI แค่ 150 mcg (ไอโอดีน) ไม่ใช่ยาเกลือโพแทสเซียม
    'Vitamin C': ['ascorbic acid'],
    'Biphasic isophane insulin (Soluble insulin + Isophane insulin)': ['insulin human'],
    'Glucose with/without sodium chloride': ['dextrose, unspecified form'],
    'Paracetamol (Acetaminophen)': ['acetaminophen'],
    'Aspirin (Acetylsalicylic acid)': ['acetylsalicylic acid'],
    'Salbutamol sulfate': ['salbutamol'],
}
SKIP = {'Hyoscine butylbromide (Hyoscine-n-butylbromide)'}   # DDInter มีแต่ scopolamine (ออกฤทธิ์ต่อสมอง) ไม่ใช่ butylbromide
