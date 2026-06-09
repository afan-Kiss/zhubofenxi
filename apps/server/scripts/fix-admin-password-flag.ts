import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'

config({ path: path.resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } })
  if (!admin) {
    console.error('未找到 username=admin 的用户')
    process.exit(1)
  }

  await prisma.user.update({
    where: { id: admin.id },
    data: {
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })

  console.log('admin 默认密码提示状态已修复。')
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
